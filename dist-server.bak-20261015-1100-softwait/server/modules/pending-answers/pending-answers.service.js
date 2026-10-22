/**
 * Pending answers: one way to answer an agent's open request (AskUserQuestion,
 * plan approval, tool permission) from any channel — the chat UI, a push
 * button, a Telegram button.
 *
 *   answer()       access check → engine delivery → status update → spend tokens
 *   issueTokens()  one-time buttons for push / Telegram (16 random bytes, 24 h,
 *                  bound to user + request + choice)
 *   redeemToken()  a button was pressed: the token is the right to answer
 *
 * The engine difference (Claude resolves a paused SDK call, Grok starts a
 * resumed run) lives in the injected engine, which the chat gateway provides
 * at boot — this module never imports the gateway.
 */
import { randomBytes } from 'node:crypto';
import { answerTokensDb, userDb } from '../../modules/database/index.js';
import { sessionAttention } from '../../modules/session-attention/session-attention.service.js';
import { isModActive, isModOn as defaultIsModOn, MOD_OFF } from '../../shared/mods.js';
import { canUserAccessSession } from '../../shared/project-access.js';
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 16;
function toUserId(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function defaultGetUserRole(userId) {
    const user = userDb.getUserById(userId);
    return user ? String(user.role ?? 'user') : null;
}
function parseDecision(json) {
    try {
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export function createPendingAnswersService(dependencies = {}) {
    const findInRegistry = dependencies.findRequest ?? ((requestId) => sessionAttention.findPendingRequest(requestId));
    const recordAnswer = dependencies.recordAnswer ?? ((requestId) => sessionAttention.recordAnswer(requestId));
    const getUserRole = dependencies.getUserRole ?? defaultGetUserRole;
    const canAccessSession = dependencies.canAccessSession ?? canUserAccessSession;
    const now = dependencies.now ?? (() => new Date());
    const ttlMs = dependencies.ttlMs ?? TOKEN_TTL_MS;
    const isModOn = dependencies.isModOn ?? defaultIsModOn;
    let engine = dependencies.engine ?? null;
    /** Requests being delivered right now: a second tap must not reach the engine twice. */
    const inFlight = new Set();
    function resolveActor(actorUserId, actorRole) {
        const id = toUserId(actorUserId);
        const role = actorRole ?? (id === null ? null : getUserRole(id));
        return { id, role: role ?? null };
    }
    function findRequest(requestId, using) {
        return findInRegistry(requestId) ?? using?.locate(requestId) ?? null;
    }
    /** Admin, or access to the project of the session that asked. */
    function actorMayAnswer(actor, request) {
        if (actor.role === 'admin') {
            return true;
        }
        return request.sessionId !== null && canAccessSession(actor, request.sessionId);
    }
    function spend(requestId) {
        return answerTokensDb.spendRequest(requestId, now().toISOString());
    }
    const service = {
        /** Wires the engines (done once at boot by the chat gateway). */
        setEngine(next) {
            engine = next;
        },
        /**
         * Answers an open request on behalf of `actorUserId`.
         * `actorRole` is looked up when omitted (push / Telegram know only the user id).
         * Tokens are spent and the status updated only after the engine took the
         * answer; a failed delivery leaves the request and its buttons alive.
         */
        async answer(input) {
            const using = input.engine ?? engine;
            const actor = resolveActor(input.actorUserId, input.actorRole);
            const request = findRequest(input.requestId, using);
            if (!request) {
                return { ok: false, reason: 'not_pending' };
            }
            if (!actorMayAnswer(actor, request)) {
                return { ok: false, reason: 'forbidden' };
            }
            if (!using) {
                return { ok: false, reason: 'unavailable' };
            }
            if (inFlight.has(input.requestId)) {
                return { ok: false, reason: 'in_progress' };
            }
            inFlight.add(input.requestId);
            try {
                let delivered = false;
                try {
                    delivered = await using.deliver({
                        requestId: input.requestId,
                        decision: input.decision,
                        actor,
                        via: input.via,
                        connection: input.connection ?? null,
                        request,
                    });
                }
                catch (error) {
                    console.error('[PendingAnswers] delivery failed', { requestId: input.requestId, error: error?.message });
                }
                if (!delivered) {
                    return { ok: false, reason: findRequest(input.requestId, using) ? 'unavailable' : 'not_pending' };
                }
                // Status and buttons follow delivery and must never undo it.
                try {
                    recordAnswer(input.requestId);
                }
                catch (error) {
                    console.error('[PendingAnswers] status update failed', { requestId: input.requestId, error: error?.message });
                }
                try {
                    spend(input.requestId);
                }
                catch (error) {
                    console.error('[PendingAnswers] could not spend answer tokens', { requestId: input.requestId, error: error?.message });
                }
                return { ok: true };
            }
            finally {
                inFlight.delete(input.requestId);
            }
        },
        /** One token per choice; all of them die together once the request is answered. */
        issueTokens(requestId, userId, choices) {
            const owner = toUserId(userId);
            if (owner === null || !requestId || choices.length === 0) {
                return [];
            }
            const createdAt = now();
            const expiresAt = new Date(createdAt.getTime() + ttlMs).toISOString();
            const issued = choices.map((choice) => ({
                choice,
                token: randomBytes(TOKEN_BYTES).toString('base64url'),
            }));
            try {
                answerTokensDb.deleteExpired(new Date(createdAt.getTime() - ttlMs).toISOString());
            }
            catch {
                // housekeeping only
            }
            answerTokensDb.insertMany(issued.map(({ choice, token }) => ({
                token,
                request_id: requestId,
                user_id: owner,
                choice_id: choice.id,
                label: choice.label,
                decision_json: JSON.stringify(choice.decision),
                created_at: createdAt.toISOString(),
                expires_at: expiresAt,
                used_at: null,
            })));
            return issued.map(({ choice, token }) => ({ id: choice.id, label: choice.label, token }));
        },
        /**
         * A button was pressed. Channel-independent: the caller passes
         * `actorUserId` when it knows who pressed (Telegram: the user bound to the
         * chat) — a mismatch with the token owner is refused. Push has no identity
         * besides the token, so it passes none. The token is spent only when the
         * answer reached the engine.
         */
        async redeemToken(token, options = {}) {
            const row = typeof token === 'string' && token ? answerTokensDb.get(token) : null;
            if (!row) {
                return { ok: false, reason: 'invalid' };
            }
            if (row.used_at) {
                return { ok: false, reason: 'already_answered' };
            }
            if (Date.parse(row.expires_at) <= now().getTime()) {
                return { ok: false, reason: 'expired' };
            }
            if (options.actorUserId !== undefined && toUserId(options.actorUserId) !== row.user_id) {
                return { ok: false, reason: 'forbidden' };
            }
            // Buttons issued before the owner switched them off do not answer any
            // more; the request stays open for the chat in Neo3 itself.
            if (!isModActive(row.user_id, 'modAnswerButtons', isModOn)) {
                return { ok: false, reason: MOD_OFF };
            }
            const decision = parseDecision(row.decision_json);
            if (!decision) {
                return { ok: false, reason: 'invalid' };
            }
            const sessionId = findRequest(row.request_id, engine)?.sessionId ?? undefined;
            const result = await service.answer({
                requestId: row.request_id,
                decision,
                actorUserId: row.user_id,
                via: options.via ?? 'push',
            });
            if (result.ok) {
                return { ok: true, label: row.label, sessionId: sessionId ?? null };
            }
            // in_progress: another tap is being delivered right now — not answered
            // yet, so the push must keep its buttons in case that delivery fails.
            const reason = result.reason === 'not_pending' ? 'already_answered' : result.reason;
            return { ok: false, reason, ...(sessionId ? { sessionId } : {}) };
        },
        /** Same rule the answer path applies: admin, or access to the request's project. */
        canUserAnswer(user, requestId) {
            const request = findRequest(requestId, engine);
            return request !== null && actorMayAnswer(resolveActor(user.id, user.role), request);
        },
    };
    return service;
}
/** Process-wide instance: chat gateway, push route and Telegram share it. */
export const pendingAnswers = createPendingAnswersService();
//# sourceMappingURL=pending-answers.service.js.map
/**
 * "Нужен ответ" push for every engine.
 *
 * Subscribed to session-attention: when a session starts waiting for the user
 * (Claude/Grok question, plan, permission; any engine whose turn ended with a
 * question or a request to do something by hand) the user who started the run
 * gets exactly one push per request. Answerable requests carry one-time
 * buttons; the push stays up until the session stops waiting, then it is
 * closed by tag — whichever channel answered.
 */
import { ATTENTION_PUSH_CODE, attentionPushTag } from '../../../modules/notifications/services/attention-push.constants.js';
import { createNotificationEvent, notifyUserIfEnabled, } from '../../../modules/notifications/services/notification-orchestrator.service.js';
import { pendingAnswers, } from '../../../modules/pending-answers/pending-answers.service.js';
import { isModActive, isModOn as defaultIsModOn } from '../../../shared/mods.js';
/** Android shows at most two notification buttons. */
const MAX_PUSH_ANSWER_BUTTONS = 2;
const PUSHED_KEY_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * The one rule for "a question that can be answered with one tap": the
 * request asks exactly one question and it is not multiselect. Push and
 * Telegram buttons, and the Telegram text, all follow it.
 */
export function singleChoiceQuestion(change) {
    if (change.reason !== 'ask') {
        return null;
    }
    const questions = change.detail?.questions ?? [];
    return questions.length === 1 && !questions[0].multiSelect ? questions[0] : null;
}
/**
 * Answer choices of a waiting session, shared by push and Telegram (Решение 16):
 * - one question, single choice → its options, first `maxOptions` of them;
 * - plan → «Одобрить»;
 * - permission → «Разрешить» / «Отклонить»;
 * - anything else (several questions, multiselect, text question, manual
 *   ask, no request id to answer) → none.
 */
export function pickAnswerChoices(change, maxOptions) {
    const requestId = change.detail?.requestId;
    if (!requestId) {
        return [];
    }
    if (change.reason === 'ask') {
        const only = singleChoiceQuestion(change);
        if (!only || only.options.length === 0) {
            return [];
        }
        return only.options.slice(0, Math.max(0, maxOptions)).map((option, index) => ({
            id: `opt${index + 1}`,
            label: option.label,
            decision: { allow: true, answers: { [only.question]: option.label } },
        }));
    }
    if (change.reason === 'plan') {
        return [{ id: 'approve', label: 'Одобрить', decision: { allow: true } }];
    }
    if (change.reason === 'permission') {
        return [
            { id: 'allow', label: 'Разрешить', decision: { allow: true } },
            { id: 'deny', label: 'Отклонить', decision: { allow: false } },
        ];
    }
    return [];
}
/**
 * Which buttons a waiting session's push gets: the first two answer choices
 * (Android limit), plus «Открыть» for a plan or when nothing is answerable.
 * Tapping the notification body always opens the session.
 */
export function planAttentionPush(change) {
    const choices = pickAnswerChoices(change, MAX_PUSH_ANSWER_BUTTONS);
    return { choices, withOpenButton: choices.length === 0 || change.reason === 'plan' };
}
export function createAttentionPushListener(dependencies = {}) {
    const notify = dependencies.notify ?? ((input) => notifyUserIfEnabled(input));
    const issueTokens = dependencies.issueTokens
        ?? ((requestId, userId, choices) => pendingAnswers.issueTokens(requestId, userId, choices));
    const now = dependencies.now ?? (() => Date.now());
    const isModOn = dependencies.isModOn ?? defaultIsModOn;
    /** Requests already pushed (dedupe): session + request id, or session + turn time for text endings. */
    const pushedKeys = new Map();
    /** Who got the currently shown push of a session — the close goes to them. */
    const shownTo = new Map();
    function prune() {
        const cutoff = now() - PUSHED_KEY_TTL_MS;
        for (const [key, at] of pushedKeys) {
            if (at < cutoff) {
                pushedKeys.delete(key);
            }
        }
    }
    function close(change) {
        const recipients = new Set();
        const shown = shownTo.get(change.sessionId);
        if (shown !== undefined)
            recipients.add(shown);
        if (change.userId !== null)
            recipients.add(change.userId);
        shownTo.delete(change.sessionId);
        const tag = attentionPushTag(change.sessionId);
        for (const userId of recipients) {
            notify({
                userId,
                event: createNotificationEvent({
                    provider: change.provider,
                    sessionId: change.sessionId,
                    code: 'notification.close',
                    meta: { tag },
                    dedupeKey: `attention-close:${change.sessionId}:${change.updatedAt}:${userId}`,
                }),
            });
        }
    }
    return function onAttentionChange(change) {
        const wasWaiting = change.previous?.state === 'waiting';
        if (change.state !== 'waiting') {
            if (wasWaiting) {
                close(change);
            }
            return;
        }
        const requestId = change.detail?.requestId ?? null;
        const isNewRequest = !wasWaiting || (requestId !== null && requestId !== change.previous?.requestId);
        if (!isNewRequest || change.userId === null) {
            return;
        }
        // «Ждут тебя» switched off: no push for this user. Closing a push shown
        // before the switch (above) still works.
        if (!isModActive(change.userId, 'modAttention', isModOn)) {
            return;
        }
        prune();
        const key = `${change.sessionId}:${requestId ?? `turn:${change.updatedAt}`}`;
        if (pushedKeys.has(key)) {
            return;
        }
        pushedKeys.set(key, now());
        const plan = planAttentionPush(change);
        let tokens = [];
        if (requestId && plan.choices.length > 0 && isModActive(change.userId, 'modAnswerButtons', isModOn)) {
            try {
                tokens = issueTokens(requestId, change.userId, plan.choices);
            }
            catch (error) {
                // Buttons are a convenience; the push itself must still go out.
                console.error('[AttentionPush] could not issue answer tokens', { sessionId: change.sessionId, error: error?.message });
            }
        }
        const actions = tokens.map((token) => ({ action: `answer:${token.id}`, title: token.label }));
        const answers = Object.fromEntries(tokens.map((token) => [`answer:${token.id}`, token.token]));
        if (plan.withOpenButton || tokens.length === 0) {
            actions.push({ action: 'open', title: 'Открыть' });
        }
        shownTo.set(change.sessionId, change.userId);
        notify({
            userId: change.userId,
            event: createNotificationEvent({
                provider: change.provider,
                sessionId: change.sessionId,
                kind: 'action_required',
                code: ATTENTION_PUSH_CODE,
                meta: {
                    reason: change.reason,
                    question: change.detail?.question ?? null,
                    options: change.detail?.options ?? [],
                    questionCount: change.detail?.questions?.length ?? 0,
                    excerpt: change.detail?.excerpt ?? null,
                    actions,
                    answers,
                },
                severity: 'warning',
                requiresUserAction: true,
                dedupeKey: `attention:${key}`,
            }),
        });
    };
}
//# sourceMappingURL=attention-push.service.js.map
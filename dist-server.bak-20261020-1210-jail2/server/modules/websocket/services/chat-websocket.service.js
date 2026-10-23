import path from 'node:path';
import { projectsDb, sessionLinksDb, sessionsDb, sessionThreadsDb } from '../../../modules/database/index.js';
import { newRunId, recordAuditEvent, RunMeter } from '../../../modules/governance/index.js';
import { pendingAnswers, } from '../../../modules/pending-answers/pending-answers.service.js';
import { sessionAttention } from '../../../modules/session-attention/session-attention.service.js';
import { rememberRunOptions } from '../../../modules/auto-relay/run-options.js';
import { threadTokens } from '../../../modules/threads/thread-tokens.js';
import { beginServiceTurn } from '../../../shared/service-turns.js';
import { isRelayRequestText } from '../../../../shared/relay-rules.js';
import { backgroundConsoleOn, chatRunRegistry } from '../../../modules/websocket/services/chat-run-registry.service.js';
import { clientIdentities, readSocketUserId } from '../../../modules/websocket/services/project-access.service.js';
import { connectedClients, WS_OPEN_STATE } from '../../../modules/websocket/services/websocket-state.service.js';
import { appendAttachedFilesTag, appendVisibleImagePathsTag, getGlobalImageAssetsDir, normalizeImageDescriptors, splitAttachmentsByKind, } from '../../../shared/image-attachments.js';
import { listGrokQuestionsForAppSession, peekGrokPlanExit, peekGrokQuestion, registerGrokPlanExit, registerGrokQuestion, rewriteGrokHeadlessQuestionStub, serializeGrokQuestionAnswers, takeGrokPlanExit, takeGrokQuestion, takeGrokQuestionsForAppSession, } from '../../../shared/grok-question.js';
import { isModOn, MOD_OFF } from '../../../shared/mods.js';
import { canAccessSession } from '../../../shared/project-access.js';
import { JAIL_DENIED_MESSAGE, JAIL_PROVIDER_MESSAGE, JAILED_PROVIDERS, userJailFor } from '../../../shared/user-jail.js';
import { threadsApiUrl } from '../../../shared/threads-env.js';
import { createNormalizedMessage, parseIncomingJsonObject } from '../../../shared/utils.js';
/**
 * Runtimes that build their own image reference block (`appendImagesInputTag`)
 * because their CLI has no vision — the gateway must not add a second one.
 */
const PROVIDERS_WITH_RUNTIME_IMAGE_TAG = new Set(['cursor', 'opencode']);
/**
 * Trust boundary for client-supplied image attachments: chat.send options come
 * straight from the browser, and the provider runtimes read the referenced
 * files off disk (Claude base64-encodes them into the prompt). Only images
 * that live directly inside the global upload store (`~/.cloudcli/assets`,
 * where POST /api/assets/images puts them) are allowed through — anything
 * else (absolute paths elsewhere, traversal, subdirectories) is dropped.
 *
 * Exported for tests; `assetsRootOverride` exists only for them.
 */
export function filterImagesToUploadStore(images, assetsRootOverride) {
    const assetsRoot = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());
    return normalizeImageDescriptors(images).filter((descriptor) => {
        // Relative paths are anchored in the store; absolute ones must already be in it.
        const resolved = path.resolve(assetsRoot, descriptor.path);
        const relative = path.relative(assetsRoot, resolved);
        const isDirectChild = relative.length > 0 &&
            !relative.startsWith('..') &&
            !path.isAbsolute(relative) &&
            !relative.includes(path.sep) &&
            !relative.includes('/');
        if (!isDirectChild) {
            console.warn(`[Chat] Dropping image outside the upload store: ${descriptor.path}`);
        }
        return isDirectChild;
    });
}
/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
function readRequestUserId(request) {
    return readSocketUserId(request?.user);
}
/** Reads the authenticated request user's role, if present (added alongside userId/username). */
function readRequestUserRole(request) {
    const role = request?.user?.role;
    return typeof role === 'string' ? role : null;
}
function sendJson(ws, payload) {
    if (ws.readyState === WS_OPEN_STATE) {
        ws.send(JSON.stringify(payload));
    }
}
/**
 * Reports a protocol-level failure to the requesting client.
 *
 * Protocol errors deliberately use their own `kind` (instead of the provider
 * `error` message kind) so the frontend can distinguish "your request was
 * invalid" from "the model run produced an error" without inspecting text.
 */
function sendProtocolError(ws, code, error, sessionId) {
    sendJson(ws, {
        kind: 'protocol_error',
        code,
        error,
        sessionId: sessionId ?? null,
        timestamp: new Date().toISOString(),
    });
}
function readRequiredSessionId(data) {
    const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
    return sessionId.length > 0 ? sessionId : null;
}
/**
 * `thread` access (agent threads): the actor is the parent chat's user, checked
 * against the project-access rule now, and the target is either the parent
 * itself («Треды готовы») or one of its threads.
 */
function canStartThreadRun(access, sessionId) {
    return canStartLinkedRun(access, sessionId, 'thread');
}
/**
 * Server-started runs on behalf of a chat's user: the actor must have access
 * to the target now, and the target is the chat itself or its child of the
 * given relation — which `linkSession` only allows in the same project
 * (checked again here, the link may predate a project move).
 * `thread`: «Треды готовы» to the parent, or a thread run.
 * `auto-relay`: the handoff request in the chat, or its relay continuation.
 */
function canStartLinkedRun(access, sessionId, relation) {
    if (!canAccessSession({ id: access.userId }, sessionId)) {
        return false;
    }
    if (sessionId === access.parentSessionId) {
        return true;
    }
    const link = sessionLinksDb.getRow(sessionId);
    if (link?.relation !== relation || link.parent_session_id !== access.parentSessionId) {
        return false;
    }
    const parent = sessionLinksDb.getRow(access.parentSessionId);
    return Boolean(parent && parent.project_path && parent.project_path === link.project_path);
}
/**
 * Handles `chat.send`: resolves the session row (provider, project path, and
 * provider-native id all come from the database — never from the client),
 * registers the run, and dispatches to the provider runtime.
 */
async function handleChatSend(ws, userId, userRole, data, dependencies) {
    const start = beginChatSend(ws, userId, userRole, data, dependencies, { kind: 'socket' });
    if (start.started) {
        await start.finished;
    }
}
/**
 * Synchronous half of `chat.send`: validation, access check and run
 * registration. `started` is the explicit result of registering the run;
 * `finished` settles when the runtime is done.
 */
function beginChatSend(ws, userId, userRole, data, dependencies, access) {
    const sessionId = readRequiredSessionId(data);
    if (!sessionId) {
        sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.send requires a sessionId.');
        return { started: false };
    }
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
        sendProtocolError(ws, 'SESSION_NOT_FOUND', `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`, sessionId);
        return { started: false };
    }
    // Non-admin employees may only open sessions for projects an admin granted
    // them via the admin panel — listing already filters the sidebar, but a
    // known/guessed sessionId must not bypass that (see user_project_access).
    // The identity is the socket's authenticated user and the role comes from
    // the database: no user → refused, a session without a project → admins
    // only. The single exception is a detached continuation whose actor
    // `pendingAnswers` has already checked (see ChatSendAccess).
    const accessDenied = access.kind === 'socket'
        ? !canAccessSession(clientIdentities.get(ws), sessionId)
        : access.kind === 'thread'
            ? !canStartThreadRun(access, sessionId)
            : access.kind === 'auto-relay' && !canStartLinkedRun(access, sessionId, 'relay');
    if (accessDenied) {
        sendProtocolError(ws, 'PROJECT_ACCESS_DENIED', 'You do not have access to this project.', sessionId);
        return { started: false };
    }
    const provider = session.provider;
    const spawnFn = dependencies.spawnFns[provider];
    if (!spawnFn) {
        sendProtocolError(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
        return { started: false };
    }
    // Non-admins work inside their project folder only: their engine runs in a
    // macOS sandbox fenced to it (server/shared/user-jail.ts). Engines that
    // cannot be fenced are closed to them.
    const jail = (dependencies.userJailFor ?? userJailFor)(userId, session.project_path);
    if (jail === 'deny') {
        sendProtocolError(ws, 'PROJECT_JAIL_DENIED', JAIL_DENIED_MESSAGE, sessionId);
        return { started: false };
    }
    if (jail && !JAILED_PROVIDERS.has(provider)) {
        sendProtocolError(ws, 'PROJECT_JAIL_PROVIDER', JAIL_PROVIDER_MESSAGE, sessionId);
        return { started: false };
    }
    const run = chatRunRegistry.startRun({
        appSessionId: sessionId,
        provider,
        providerSessionId: session.provider_session_id,
        connection: ws,
        userId,
        projectId: session.project_path ? projectsDb.getProjectPath(session.project_path)?.project_id ?? null : null,
        canStopTasks: Boolean(dependencies.stopTaskFns?.[provider]),
    });
    if (!run) {
        sendProtocolError(ws, 'RUN_IN_PROGRESS', `Session "${sessionId}" already has a run in progress.`, sessionId);
        return { started: false };
    }
    // Typing an answer while Grok's synthetic question panel is up is the
    // supported fallback ("2" as text). Drop the panel so a later click does
    // not start a second resume. Only once the new turn is registered: a send
    // that did not start must not destroy the open questions.
    if (provider === 'grok') {
        for (const pending of takeGrokQuestionsForAppSession(sessionId)) {
            sendJson(ws, createNormalizedMessage({
                kind: 'permission_cancelled',
                requestId: pending.requestId,
                sessionId,
                provider: 'grok',
            }));
        }
    }
    const clientOptions = (data.options ?? {});
    const rawContent = typeof data.content === 'string' ? data.content : '';
    // Auto-relay repeats a person's engine settings (model, effort, mode, tools)
    // on its own turns; only runs a person started count.
    if (access.kind === 'socket') {
        rememberRunOptions(sessionId, clientOptions);
    }
    // Client attachments are re-validated to the upload store, then split: images
    // ride along as vision blocks (per provider), while other files are referenced
    // by path in an <attached_files> block the agent reads with its own tools.
    const { images: imageAttachments, files: fileAttachments } = splitAttachmentsByKind(filterImagesToUploadStore(clientOptions.images));
    const commandWithFiles = appendAttachedFilesTag(rawContent, fileAttachments);
    // Runtimes that show the picture to the model (Claude, Codex) used to pass the
    // image and nothing else, leaving the agent unable to name the file it can
    // see — so it could not feed it to a tool (`vis --ref`, ffmpeg, an upload).
    // Cursor and OpenCode are left alone: they have no vision and already append
    // their own "read these files" block inside the runtime.
    const command = PROVIDERS_WITH_RUNTIME_IMAGE_TAG.has(provider)
        ? commandWithFiles
        : appendVisibleImagePathsTag(commandWithFiles, imageAttachments);
    // The provider runtimes receive the provider-native session id (that is the
    // id their CLI/SDK understands for resume). Brand-new sessions have no
    // provider id yet, so the runtime starts fresh and announces one, which the
    // gateway writer captures and maps back to the app session id.
    const runtimeOptions = {
        ...clientOptions,
        // Only image attachments reach the provider runtimes' vision path; non-image
        // files were folded into `command` above as an <attached_files> block.
        images: imageAttachments,
        sessionId: session.provider_session_id ?? undefined,
        // Push notifications deep-link to /session/<app id>, which is what the UI
        // routes on — the provider-native id above would not resolve there.
        appSessionId: sessionId,
        resume: Boolean(session.provider_session_id),
        cwd: userRole === 'admin' ? (clientOptions.cwd ?? session.project_path ?? undefined) : session.project_path ?? undefined,
        projectPath: session.project_path ?? clientOptions.projectPath,
    };
    // Set by the server only: a client cannot send its own `jail` (or `null`).
    delete runtimeOptions.jail;
    if (jail) {
        const assetsRoot = getGlobalImageAssetsDir();
        runtimeOptions.jail = {
            root: jail.root,
            readFiles: [...imageAttachments, ...fileAttachments].map((attachment) => path.resolve(assetsRoot, String(attachment.path))),
        };
    }
    // Auto-relay handoff request: a service turn (no «run stopped» push of its
    // own) that may write its note into docs/handoff/ without asking. Decided
    // here from the access kind and the request text — a client cannot claim it.
    delete runtimeOptions.autoRelayNoteDir;
    const relayServiceTurn = access.kind === 'auto-relay' && isRelayRequestText(rawContent);
    if (relayServiceTurn && session.project_path) {
        runtimeOptions.autoRelayNoteDir = path.join(session.project_path, 'docs', 'handoff');
    }
    const endServiceTurn = relayServiceTurn ? beginServiceTurn(sessionId) : null;
    // One run, one audit trail. The meter rides along in the runtime options and
    // is fed by the engine as usage arrives. Claude and Grok report real usage;
    // other engines still record the run with token counts of zero rather than
    // an invented price.
    const runId = newRunId();
    const meter = new RunMeter();
    const startedAt = Date.now();
    runtimeOptions.meter = meter;
    // Threads: this run's identity for the neo3-threads MCP server, put into the
    // engine env by the runtime (server/shared/threads-env.ts). Valid until the
    // run ends + 24 h. A failure here never blocks the run — it only goes
    // without threads.
    // «Треды» switched off: the run carries the «off» marker, so opening or
    // writing to a thread is refused in plain words. A token is still issued
    // when this chat already has threads — thread_status / stop_thread keep
    // working on them; a chat without threads gets no token at all.
    let threadsToken = null;
    const threadsOn = (dependencies.isModOn ?? isModOn)(userId, 'modThreads');
    if (threadsOn || sessionThreadsDb.listByParent(sessionId).length > 0) {
        try {
            threadsToken = threadTokens.issue({ sessionId, userId, permissionMode: clientOptions.permissionMode });
        }
        catch (error) {
            console.error('[Chat] Thread token was not issued', {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    const threadsEnv = {
        ...(threadsToken ? { NEO3_THREADS_TOKEN: threadsToken, NEO3_THREADS_API_URL: threadsApiUrl() } : {}),
        ...(threadsOn ? {} : { NEO3_THREADS_OFF: '1' }),
    };
    if (Object.keys(threadsEnv).length > 0) {
        runtimeOptions.threadsEnv = threadsEnv;
    }
    recordAuditEvent({
        actor: 'user',
        event: 'run.start',
        userId: userId === null ? null : Number(userId),
        projectPath: session.project_path ?? null,
        sessionId,
        runId,
        provider,
        model: typeof clientOptions.model === 'string' ? clientOptions.model : null,
        detail: command,
    });
    const finished = (async () => {
        let outcome = 'ok';
        let failureDetail = null;
        try {
            await spawnFn(command, runtimeOptions, run.writer);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            outcome = 'error';
            failureDetail = message;
            console.error(`[Chat] Provider runtime "${provider}" failed`, { sessionId, error: message });
        }
        finally {
            endServiceTurn?.();
            try {
                threadTokens.end(threadsToken);
            }
            catch {
                // The token then expires at the next boot (threadTokens.reconcileOnBoot).
            }
            const cost = meter.finish();
            recordAuditEvent({
                actor: 'user',
                event: outcome === 'error' ? 'run.error' : 'run.finish',
                userId: userId === null ? null : Number(userId),
                projectPath: session.project_path ?? null,
                sessionId,
                runId,
                provider,
                model: cost.model ?? (typeof clientOptions.model === 'string' ? clientOptions.model : null),
                outcome,
                detail: failureDetail,
                tokensIn: cost.breakdown.inputTokens,
                tokensOut: cost.breakdown.outputTokens,
                cacheRead: cost.breakdown.cacheReadTokens,
                cacheWrite5m: cost.breakdown.cacheWrite5mTokens,
                cacheWrite1h: cost.breakdown.cacheWrite1hTokens,
                costMicroUsd: cost.costMicroUsd,
                durationMs: Date.now() - startedAt,
            });
            // Safety net: a runtime that crashed (or resolved) without emitting its
            // terminal `complete` would otherwise leave the session stuck in
            // "processing" forever on every connected client. Scoped to THIS run —
            // a queued message can start the session's next run before this promise
            // settles, and the session-keyed completeRun would kill that new run.
            chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
        }
    })();
    return { started: true, finished };
}
/**
 * Handles `chat.abort`: cancels the run for one app session and emits the
 * terminal `complete` on its behalf (runtimes skip their own complete for
 * aborted runs, and the registry drops any duplicate).
 */
async function handleChatAbort(ws, data, dependencies, userId = null) {
    const sessionId = readRequiredSessionId(data);
    if (!sessionId) {
        sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.abort requires a sessionId.');
        return;
    }
    if (!(await abortSessionRun(sessionId, dependencies, userId))) {
        sendProtocolError(ws, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`, sessionId);
    }
}
/**
 * Stops the live run of one app session — the Stop button, also used by
 * `stop_thread`. False when the session has nothing running.
 */
async function abortSessionRun(sessionId, dependencies, userId) {
    const run = chatRunRegistry.getRun(sessionId);
    if (!run || run.status !== 'running') {
        return false;
    }
    const abortFn = dependencies.abortFns[run.provider];
    // "Ждут тебя": the aborted session is marked seen for whoever pressed Stop.
    try {
        sessionAttention.recordStopActor(sessionId, userId);
    }
    catch (error) {
        console.error('[Chat] Session attention stop update failed', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    // Complete FIRST, kill second. Marking the run finished fences its event
    // stream (the registry drops everything a still-winding-down runtime emits),
    // so no output can land in the chat after the user pressed Stop — and the
    // UI gets its answer immediately instead of waiting out the interrupt RPC.
    chatRunRegistry.completeRun(sessionId, { exitCode: 0, aborted: true });
    if (!abortFn) {
        return true;
    }
    if (run.providerSessionId) {
        await abortFn(run.providerSessionId);
        return true;
    }
    // Brand-new chat whose runtime has not announced its native session id yet:
    // there is nothing to address the abort with, so arm it to fire the instant
    // the id arrives. Without this the agent kept running (and kept spending
    // tokens) after a Stop pressed in the first seconds of a chat.
    chatRunRegistry.armPendingAbort(sessionId, (providerSessionId) => {
        void Promise.resolve(abortFn(providerSessionId)).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[Chat] Deferred abort failed', { sessionId, error: message });
        });
    });
    return true;
}
/**
 * Handles `chat.stop-task`: stops one background task of the session's live
 * run and answers the requester with `background_task_stop`
 * `{sessionId, taskId, ok, reason?}`. Access is checked by the caller.
 */
async function handleChatStopTask(ws, data, dependencies, userId = null) {
    const sessionId = readRequiredSessionId(data);
    if (!sessionId) {
        sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.stop-task requires a sessionId.');
        return;
    }
    const taskId = typeof data.taskId === 'string' ? data.taskId.trim() : '';
    if (!taskId) {
        sendProtocolError(ws, 'TASK_ID_REQUIRED', 'chat.stop-task requires a taskId.', sessionId);
        return;
    }
    const reply = (result) => sendJson(ws, {
        kind: 'background_task_stop',
        sessionId,
        taskId,
        ok: result.ok,
        ...(result.reason ? { reason: result.reason } : {}),
        timestamp: new Date().toISOString(),
    });
    if (!backgroundConsoleOn(userId, dependencies.isModOn)) {
        reply({ ok: false, reason: MOD_OFF });
        return;
    }
    const run = chatRunRegistry.getRun(sessionId);
    const stopTaskFn = run ? dependencies.stopTaskFns?.[run.provider] : undefined;
    if (!run || run.status !== 'running' || !run.providerSessionId) {
        reply({ ok: false, reason: 'turn_ended' });
        return;
    }
    if (!stopTaskFn) {
        reply({ ok: false, reason: 'unsupported' });
        return;
    }
    try {
        reply(await stopTaskFn(run.providerSessionId, taskId));
    }
    catch (error) {
        console.error('[Chat] Stopping a background task failed', {
            sessionId,
            taskId,
            error: error instanceof Error ? error.message : String(error),
        });
        reply({ ok: false, reason: 'failed' });
    }
}
/**
 * Handles `chat.subscribe`: for each requested session, reports whether a run
 * is processing, re-attaches the live stream to this socket, replays missed
 * events (seq > lastSeq), and includes pending permission requests.
 *
 * This single message replaces the old `check-session-status`,
 * `get-pending-permissions`, and Claude-only writer reconnect flows.
 */
function handleChatSubscribe(ws, data, dependencies, userId = null) {
    const targets = Array.isArray(data.sessions) ? data.sessions : [];
    for (const target of targets) {
        if (!target || typeof target !== 'object') {
            continue;
        }
        const sessionId = typeof target.sessionId === 'string'
            ? target.sessionId.trim()
            : '';
        if (!sessionId) {
            continue;
        }
        if (!canAccessSession(clientIdentities.get(ws), sessionId)) {
            sendProtocolError(ws, 'PROJECT_ACCESS_DENIED', 'You do not have access to this project.', sessionId);
            continue;
        }
        const lastSeqRaw = target.lastSeq;
        const lastSeq = typeof lastSeqRaw === 'number' && Number.isFinite(lastSeqRaw)
            ? Math.max(0, Math.floor(lastSeqRaw))
            : 0;
        const run = chatRunRegistry.getRun(sessionId);
        const isProcessing = chatRunRegistry.isProcessing(sessionId);
        // Future live events for this run should land on the socket that asked —
        // this is what makes mid-stream page refreshes work for all providers.
        if (isProcessing) {
            chatRunRegistry.attachConnection(sessionId, ws);
        }
        // Pending approvals are tracked under the provider-native id inside the
        // Claude runtime; remap their sessionId so the client only sees app ids.
        // Grok questions live in Neo3 after the CLI has already exited, keyed by
        // the app session id — include them even when no run is in flight.
        const pendingPermissions = [
            ...(run?.providerSessionId
                ? dependencies.getPendingApprovalsForSession(run.providerSessionId)
                : []).map((approval) => approval && typeof approval === 'object'
                ? { ...approval, sessionId }
                : approval),
            ...listGrokQuestionsForAppSession(sessionId).map((pending) => ({
                requestId: pending.requestId,
                toolName: 'AskUserQuestion',
                input: pending.input,
                sessionId,
                provider: 'grok',
            })),
        ];
        sendJson(ws, {
            kind: 'chat_subscribed',
            sessionId,
            isProcessing,
            lastSeq: run?.lastSeq ?? 0,
            pendingPermissions,
            timestamp: new Date().toISOString(),
        });
        // Replay only for RUNNING runs, strictly after the ack. Completed runs
        // are fully persisted to the provider transcript and served over REST —
        // replaying them (e.g. after a page reload where the client's lastSeq is
        // 0) would duplicate messages the history fetch already returned.
        if (isProcessing) {
            for (const event of chatRunRegistry.replayEvents(sessionId, lastSeq)) {
                sendJson(ws, event);
            }
            // «Фон: N» after a reload or a session switch: the live list now, not
            // only whatever changes after this moment.
            const listBackgroundTasks = run?.providerSessionId ? dependencies.backgroundTasksFns?.[run.provider] : undefined;
            if (run?.providerSessionId && listBackgroundTasks && backgroundConsoleOn(userId, dependencies.isModOn)) {
                sendJson(ws, {
                    kind: 'background_tasks',
                    sessionId,
                    provider: run.provider,
                    stoppable: Boolean(dependencies.stopTaskFns?.[run.provider]),
                    tasks: listBackgroundTasks(run.providerSessionId),
                    timestamp: new Date().toISOString(),
                });
            }
        }
    }
}
/**
 * Stands in for a websocket when an answer arrives from a push or Telegram:
 * nobody is watching live, so the resumed run's events are only buffered in
 * the run registry (replayed by `chat.subscribe` when the session is opened,
 * which swaps in the real socket) and fed to the session status. A fresh
 * object per run: nothing is shared between runs, nothing is registered
 * anywhere, and it is dropped with the run.
 */
function createDetachedConnection() {
    return {
        readyState: 3, // CLOSED: the writer buffers, never sends
        send: () => { },
    };
}
/**
 * The chat gateway's side of agent threads: a thread run (and the
 * «Треды готовы» message to its parent) is an ordinary run — registry,
 * indicator, Stop, «Ждут тебя» — started without a socket on behalf of the
 * parent's user (`thread` access). Nobody watches live; opening the chat
 * subscribes and replays the buffered events.
 */
export function createThreadRunControl(dependencies) {
    return {
        start({ sessionId, userId, parentSessionId, content, options }) {
            const start = beginChatSend(createDetachedConnection(), userId, null, { sessionId, content, options }, dependencies, { kind: 'thread', userId, parentSessionId });
            if (start.started) {
                void start.finished.catch((error) => {
                    console.error('[Chat] Thread run failed', {
                        sessionId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
            }
            return start.started;
        },
        abort(sessionId, actorUserId) {
            return abortSessionRun(sessionId, dependencies, actorUserId);
        },
    };
}
/**
 * The chat gateway's side of the auto-relay: the handoff request and the
 * continuation's first message are ordinary runs — registry, indicator,
 * Stop, «Ждут тебя» — started without a socket for the chat's user
 * (`auto-relay` access). Opening the chat replays the buffered events.
 */
export function createAutoRelayRunControl(dependencies) {
    return {
        start({ sessionId, userId, parentSessionId, content, options }) {
            const start = beginChatSend(createDetachedConnection(), userId, null, { sessionId, content, options }, dependencies, { kind: 'auto-relay', userId, parentSessionId });
            if (start.started) {
                void start.finished.catch((error) => {
                    console.error('[Chat] Auto-relay run failed', {
                        sessionId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
            }
            return start.started;
        },
        backgroundTaskCount(sessionId) {
            const session = sessionsDb.getSessionById(sessionId);
            const providerSessionId = session?.provider_session_id;
            const lookup = session ? dependencies.backgroundTasksFns?.[session.provider] : undefined;
            if (!providerSessionId || !lookup) {
                return 0;
            }
            try {
                const tasks = lookup(providerSessionId);
                return Array.isArray(tasks) ? tasks.length : 0;
            }
            catch {
                // Unknown = none: the fan-out of the run itself is gone with its process.
                return 0;
            }
        },
    };
}
/** App session id behind a provider-native (or already app) session id. */
function appSessionIdOf(sessionId) {
    if (!sessionId) {
        return null;
    }
    return sessionsDb.getSessionByProviderSessionId(sessionId)?.session_id
        ?? sessionsDb.getSessionById(sessionId)?.session_id
        ?? null;
}
/** Original AskUserQuestion input of a paused Claude approval (answers get merged into it). */
function findClaudeApprovalInput(requestId, appSessionId, dependencies) {
    const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
    const direct = asRecord(dependencies.getPendingApprovalById?.(requestId)?.input);
    if (direct) {
        return direct;
    }
    if (!appSessionId) {
        return null;
    }
    const providerSessionId = chatRunRegistry.getRun(appSessionId)?.providerSessionId
        ?? sessionsDb.getSessionById(appSessionId)?.provider_session_id
        ?? null;
    if (!providerSessionId) {
        return null;
    }
    const approval = dependencies.getPendingApprovalsForSession(providerSessionId)
        .find((entry) => entry && typeof entry === 'object' && entry.requestId === requestId);
    return asRecord(approval?.input);
}
/**
 * Engines' side of `pending-answers`, one decision whichever channel it came
 * from. Claude pauses the SDK on the request, so the decision resolves it;
 * Grok has already exited, so the answer becomes the next user turn via
 * `--resume` (same path as a panel click). With no connection the resumed
 * run streams into the registry only. A Grok request whose resumed turn did
 * not start goes back to its store — the question stays open.
 */
export function createPermissionAnswerEngine(dependencies) {
    const locate = (requestId) => {
        const grokQuestion = peekGrokQuestion(requestId);
        if (grokQuestion) {
            return { requestId, sessionId: grokQuestion.appSessionId, provider: 'grok', reason: 'ask' };
        }
        const grokPlan = peekGrokPlanExit(requestId);
        if (grokPlan) {
            return { requestId, sessionId: grokPlan.appSessionId, provider: 'grok', reason: 'plan' };
        }
        const approval = dependencies.getPendingApprovalById?.(requestId);
        if (approval) {
            return { requestId, sessionId: appSessionIdOf(approval.sessionId), provider: 'claude', reason: null };
        }
        return null;
    };
    const startResumedRun = (connection, actor, data) => {
        // A panel answer arrives over a socket and is checked like any chat.send;
        // only a push/Telegram answer (no connection) continues detached, with the
        // actor already verified by pendingAnswers.
        const target = connection ?? createDetachedConnection();
        const access = connection ? { kind: 'socket' } : { kind: 'verified-answer' };
        let start;
        try {
            start = beginChatSend(target, actor.id, actor.role, data, dependencies, access);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[Chat] Resumed run failed to start', { sessionId: data.sessionId, error: message });
            return false;
        }
        if (start.started) {
            void start.finished.catch((error) => {
                console.error('[Chat] Resumed run failed', {
                    sessionId: data.sessionId,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }
        return start.started;
    };
    const deliver = async ({ requestId, decision, actor, connection, request }) => {
        const grokPending = takeGrokQuestion(requestId);
        if (grokPending) {
            const updatedInput = decision.updatedInput
                ?? (decision.answers ? { ...grokPending.input, answers: decision.answers } : undefined);
            const answersText = decision.allow === false
                ? 'Skip'
                : serializeGrokQuestionAnswers(updatedInput, grokPending.input);
            // Before the start: the resumed CLI reads its transcript when it spawns.
            rewriteGrokHeadlessQuestionStub({
                workingDir: grokPending.resumeOptions?.cwd ?? grokPending.resumeOptions?.projectPath,
                sessionUuid: grokPending.providerSessionId,
                answersText,
            });
            const started = startResumedRun(connection, actor, {
                sessionId: grokPending.appSessionId,
                content: answersText,
                options: grokPending.resumeOptions ?? {},
            });
            if (!started) {
                registerGrokQuestion(grokPending);
                return false;
            }
            return true;
        }
        const grokPlan = takeGrokPlanExit(requestId);
        if (grokPlan) {
            const approved = decision.allow !== false;
            const started = startResumedRun(connection, actor, {
                sessionId: grokPlan.appSessionId,
                content: approved
                    ? 'The plan is approved. Carry it out to the end in this turn. Do not ask for another OK. Close with: the project is done, the user should check it.'
                    : (typeof decision.message === 'string' && decision.message.trim()
                        ? decision.message
                        : 'Revise the plan.'),
                options: {
                    ...(grokPlan.resumeOptions ?? {}),
                    permissionMode: approved ? 'bypassPermissions' : 'plan',
                },
            });
            if (!started) {
                registerGrokPlanExit(grokPlan);
                return false;
            }
            return true;
        }
        let updatedInput = decision.updatedInput;
        if (updatedInput === undefined && decision.answers) {
            // Answers without the original questions would hand the CLI a broken
            // AskUserQuestion input — better not to deliver at all.
            const original = findClaudeApprovalInput(requestId, request.sessionId, dependencies);
            if (!original) {
                return false;
            }
            updatedInput = { ...original, answers: decision.answers };
        }
        dependencies.resolveToolApproval(requestId, {
            allow: Boolean(decision.allow),
            updatedInput,
            message: typeof decision.message === 'string' ? decision.message : undefined,
            rememberEntry: decision.rememberEntry,
        });
        return true;
    };
    return { locate, deliver };
}
const PERMISSION_FAILURES = {
    not_pending: { code: 'PERMISSION_REQUEST_NOT_FOUND', error: 'This request is no longer waiting for an answer.' },
    forbidden: { code: 'PERMISSION_ACCESS_DENIED', error: 'You do not have access to this session.' },
    unavailable: { code: 'PERMISSION_DELIVERY_FAILED', error: 'The answer could not be delivered; the request is still open.' },
    in_progress: { code: 'PERMISSION_ANSWER_IN_PROGRESS', error: 'This request is already being answered.' },
};
/**
 * Handles `chat.permission-response`: the chat panel's answer to an open
 * request. Goes through `pending-answers` like push and Telegram do, so the
 * same access rule applies — a session of a project the user was not granted
 * cannot be answered by guessing its request id. A refused answer is reported
 * back as a `protocol_error`, never dropped silently.
 */
async function handlePermissionResponse(ws, userId, userRole, data, dependencies) {
    if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
        return;
    }
    const result = await pendingAnswers.answer({
        requestId: data.requestId,
        decision: {
            allow: typeof data.allow === 'boolean' ? data.allow : undefined,
            updatedInput: data.updatedInput,
            message: typeof data.message === 'string' ? data.message : undefined,
            rememberEntry: data.rememberEntry,
        },
        actorUserId: userId,
        // No actorRole: pending-answers reads the role from the database, the
        // same source the project-access rule uses — a token role cannot elevate.
        via: 'ui',
        connection: ws,
        engine: createPermissionAnswerEngine(dependencies),
    });
    if (!result.ok) {
        const failure = PERMISSION_FAILURES[result.reason];
        sendJson(ws, {
            kind: 'protocol_error',
            code: failure.code,
            error: failure.error,
            requestId: data.requestId,
            sessionId: null,
            timestamp: new Date().toISOString(),
        });
    }
}
/**
 * Handles authenticated chat websocket messages used by the main chat panel.
 *
 * Inbound protocol (client to server):
 * - `chat.send`                { sessionId, content, options? }
 * - `chat.abort`               { sessionId }
 * - `chat.stop-task`           { sessionId, taskId } → `background_task_stop`
 * - `chat.subscribe`           { sessions: [{ sessionId, lastSeq? }] }
 * - `chat.permission-response` { requestId, allow, updatedInput?, message?, rememberEntry? }
 *
 * Outbound protocol (server to client): every frame is `kind`-based — either
 * a provider `NormalizedMessage` (with `seq`) or a gateway event
 * (`chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`).
 */
export function handleChatConnection(ws, request, dependencies) {
    console.log('[INFO] Chat WebSocket connected');
    clientIdentities.set(ws, request.user ?? {});
    connectedClients.add(ws);
    const userId = readRequestUserId(request);
    const userRole = readRequestUserRole(request);
    ws.on('message', async (rawMessage) => {
        try {
            const parsed = parseIncomingJsonObject(rawMessage);
            if (!parsed) {
                throw new Error('Invalid websocket payload');
            }
            const data = parsed;
            const messageType = typeof data.type === 'string' ? data.type : '';
            switch (messageType) {
                case 'chat.send':
                    await handleChatSend(ws, userId, userRole, data, dependencies);
                    return;
                case 'chat.abort':
                    if (!canAccessSession(request.user, String(data.sessionId ?? ''))) {
                        sendProtocolError(ws, 'PROJECT_ACCESS_DENIED', 'You do not have access to this project.');
                        return;
                    }
                    await handleChatAbort(ws, data, dependencies, userId);
                    return;
                case 'chat.stop-task':
                    if (!canAccessSession(request.user, String(data.sessionId ?? ''))) {
                        sendProtocolError(ws, 'PROJECT_ACCESS_DENIED', 'You do not have access to this project.');
                        return;
                    }
                    await handleChatStopTask(ws, data, dependencies, userId);
                    return;
                case 'chat.subscribe':
                    handleChatSubscribe(ws, data, dependencies, userId);
                    return;
                case 'chat.permission-response':
                    await handlePermissionResponse(ws, userId, userRole, data, dependencies);
                    return;
                default:
                    sendProtocolError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${messageType}".`);
                    return;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[ERROR] Chat WebSocket error:', message);
            sendProtocolError(ws, 'INTERNAL_ERROR', message);
        }
    });
    ws.on('close', () => {
        console.log('[INFO] Chat client disconnected');
        connectedClients.delete(ws);
    });
}
//# sourceMappingURL=chat-websocket.service.js.map
/**
 * Threads (треды): an agent opens real chats of its own project and hands
 * them tasks. A thread is an ordinary chat — in the sidebar with «↳ тред от»,
 * openable and writable by Dima — linked to its parent (`relation:'thread'`).
 *
 * Every tool call is authorised by the thread token of the parent's run
 * (see thread-tokens.ts): the token names the chat and the user, the role and
 * the project access are re-read from the database on every call.
 *
 * Rules (R24i, R25i, R17): threads live only in the parent's project and run
 * as the parent's user; at most 3 threads of a parent work at once; a thread
 * cannot open threads; Claude threads obey the 5-hour guard (local models
 * bypass it — they do not spend the subscription).
 *
 * «Треды готовы» (story 26a): once the parent is idle and every thread of the
 * current batch has settled, the parent gets one message with the results —
 * unless it already read them through thread_status.
 */
import { sessionAttentionDb, sessionLinksDb, sessionsDb, sessionThreadsDb } from '../../modules/database/index.js';
import { assertCanLinkNewChild, linkSession } from '../../modules/session-links/index.js';
import { canAccessSession } from '../../shared/project-access.js';
import { lastReplyTurn } from '../../../shared/reply-turn.js';
import { threadTokens as defaultThreadTokens } from './thread-tokens.js';
// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export const MAX_WORKING_THREADS = 3;
export const MAX_THREAD_WAIT_SEC = 600;
export const THREAD_PROVIDERS = ['claude', 'codex', 'grok'];
export const DEFAULT_THREAD_PROVIDER = 'grok';
export const DEFAULT_THREAD_MODELS = {
    grok: 'grok-4.7-build-fast',
    claude: 'opus[1m]',
    codex: 'gpt-6-sol',
};
/** Neo3 local models run on the Claude engine (Ollama speaks its protocol). */
export const LOCAL_THREAD_MODELS = ['local-qwen35-9b', 'local-ornith-9b'];
const CLAUDE_THREAD_MODELS = ['opus[1m]', 'sonnet[1m]', 'fable', ...LOCAL_THREAD_MODELS];
const GROK_THREAD_MODELS = ['grok-4.7', 'grok-4.7-build-fast'];
const CODEX_THREAD_MODEL = /^gpt-\d+(?:\.\d+)*-(?:astra|sol)$/;
export class ThreadsError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.name = 'ThreadsError';
        this.code = code;
        this.status = status;
    }
}
// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------
const TITLE_MAX = 60;
const REPLY_MAX = 4000;
const SUMMARY_REPLY_MAX = 400;
function refuse(code, message, status) {
    throw new ThreadsError(code, message, status);
}
function clip(text, max) {
    const trimmed = text.trim();
    return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}
function titleFromPrompt(prompt) {
    const firstLine = prompt.trim().split('\n')[0]?.trim() ?? '';
    return clip(firstLine || 'Тред', TITLE_MAX);
}
function readString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function isThreadProvider(value) {
    return THREAD_PROVIDERS.includes(value);
}
function isAllowedModel(provider, model) {
    if (provider === 'claude')
        return CLAUDE_THREAD_MODELS.includes(model);
    if (provider === 'grok')
        return GROK_THREAD_MODELS.includes(model);
    return CODEX_THREAD_MODEL.test(model);
}
function isLocalModel(model) {
    return LOCAL_THREAD_MODELS.includes(model);
}
async function defaultFetchMessages(sessionId) {
    const { sessionsService } = await import('../../modules/providers/services/sessions.service.js');
    const history = await sessionsService.fetchHistory(sessionId, { limit: 60, offset: 0 });
    return history.messages;
}
async function defaultCheckClaudeLimit() {
    try {
        const { checkUsageGuard, buildUsageGuardNotice } = await import('../../shared/claude-usage.js');
        const guard = await checkUsageGuard();
        return guard.blocked ? { blocked: true, notice: buildUsageGuardNotice(guard) } : { blocked: false };
    }
    catch {
        return { blocked: false };
    }
}
async function defaultListModels(provider) {
    try {
        const { providerModelsService } = await import('../../modules/providers/services/provider-models.service.js');
        const result = await providerModelsService.getProviderModels(provider);
        return (result.models?.OPTIONS ?? []).map((option) => option.value);
    }
    catch {
        return [];
    }
}
function defaultAttentionOf(sessionId) {
    const row = sessionAttentionDb.get(sessionId);
    if (!row)
        return null;
    let detail = null;
    try {
        detail = row.detail_json ? JSON.parse(row.detail_json) : null;
    }
    catch {
        detail = null;
    }
    return { state: row.state, reason: row.reason, detail };
}
// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export function createThreadsService(dependencies = {}) {
    const tokens = dependencies.tokens ?? defaultThreadTokens;
    const now = dependencies.now ?? (() => new Date());
    const attentionOf = dependencies.attentionOf ?? defaultAttentionOf;
    const fetchMessages = dependencies.fetchMessages ?? defaultFetchMessages;
    const checkClaudeLimit = dependencies.checkClaudeLimit ?? defaultCheckClaudeLimit;
    const listModels = dependencies.listModels ?? defaultListModels;
    const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
    const pollMs = dependencies.pollMs ?? 2000;
    const broadcastUpsert = dependencies.broadcastUpsert ?? ((sessionId) => {
        void import('../../modules/websocket/services/chat-run-registry.service.js')
            .then(({ chatRunRegistry }) => chatRunRegistry.broadcastSessionUpsert(sessionId))
            .catch(() => { });
    });
    // The registry lookup is synchronous once loaded; tests inject their own.
    let registryIsProcessing = null;
    const isProcessingNow = (sessionId) => {
        if (dependencies.isProcessing)
            return dependencies.isProcessing(sessionId);
        return registryIsProcessing ? registryIsProcessing(sessionId) : false;
    };
    const ensureRegistry = async () => {
        if (dependencies.isProcessing || registryIsProcessing)
            return;
        const { chatRunRegistry } = await import('../../modules/websocket/services/chat-run-registry.service.js');
        registryIsProcessing = (sessionId) => chatRunRegistry.isProcessing(sessionId);
    };
    let runControl = null;
    /** Parents a «Треды готовы» message is being prepared for (one at a time). */
    const notifying = new Set();
    /** Threads being opened per parent (reserved places under the limit of 3). */
    const openingByParent = new Map();
    function requireRunControl() {
        if (!runControl)
            refuse('THREADS_UNAVAILABLE', 'Треды сейчас недоступны: сервер ещё запускается', 503);
        return runControl;
    }
    /** Token → its chat and user, with the project access re-checked now. */
    function authorize(token) {
        const owner = tokens.resolve(token);
        if (!owner)
            refuse('TOKEN_INVALID', 'Токен треда недействителен или истёк — тред недоступен в этом прогоне', 401);
        if (!sessionsDb.getSessionById(owner.sessionId))
            refuse('SESSION_NOT_FOUND', 'Чат, которому выдан токен, не найден', 404);
        if (!canAccessSession({ id: owner.userId }, owner.sessionId))
            refuse('ACCESS_DENIED', 'Нет доступа к этому чату', 403);
        return owner;
    }
    /** A thread of the token's chat, or THREAD_NOT_FOUND. */
    function ownThread(owner, threadId) {
        const id = readString(threadId);
        const row = id ? sessionThreadsDb.get(id) : null;
        if (!row || row.parent_session_id !== owner.sessionId || !sessionsDb.getSessionById(id)) {
            refuse('THREAD_NOT_FOUND', 'У этого чата нет такого треда', 404);
        }
        return row;
    }
    async function resolveEngine(rawProvider, rawModel) {
        let providerName = rawProvider.toLowerCase();
        let model = rawModel;
        if (providerName === 'local') {
            providerName = 'claude';
            model = model || LOCAL_THREAD_MODELS[0];
        }
        if (!providerName && isLocalModel(model))
            providerName = 'claude';
        const provider = providerName || DEFAULT_THREAD_PROVIDER;
        if (!isThreadProvider(provider)) {
            refuse('PROVIDER_NOT_ALLOWED', `Тред можно открыть только на claude, codex, grok или local, а не на «${provider}»`, 400);
        }
        const catalog = await listModels(provider);
        if (!model) {
            const fallback = DEFAULT_THREAD_MODELS[provider];
            model = provider === 'codex'
                ? (catalog.includes(fallback) ? fallback : catalog.find((value) => isAllowedModel('codex', value)) ?? fallback)
                : fallback;
        }
        const inCatalog = catalog.length === 0 || catalog.includes(model) || isLocalModel(model);
        if (!isAllowedModel(provider, model) || !inCatalog) {
            const allowed = provider === 'claude'
                ? CLAUDE_THREAD_MODELS.join(', ')
                : provider === 'grok'
                    ? GROK_THREAD_MODELS.join(', ')
                    : (catalog.filter((value) => isAllowedModel('codex', value)).join(', ') || 'семейства astra/sol');
            refuse('MODEL_NOT_ALLOWED', `Модель «${model}» для ${provider} не разрешена. Можно: ${allowed}`, 400);
        }
        return { provider, model };
    }
    async function statusOf(threadId) {
        const session = sessionsDb.getSessionById(threadId);
        const row = sessionThreadsDb.get(threadId);
        const working = isProcessingNow(threadId);
        const attention = working ? null : attentionOf(threadId);
        const rawState = attention?.state;
        const state = working
            ? 'working'
            : rawState === 'waiting' || rawState === 'failed' || rawState === 'done'
                ? rawState
                : rawState === 'working' ? 'working' : 'done';
        let lastReply = null;
        try {
            const turn = lastReplyTurn(await fetchMessages(threadId));
            lastReply = turn ? clip(turn.assistant, REPLY_MAX) : null;
        }
        catch {
            lastReply = null;
        }
        const item = {
            threadId,
            title: session?.custom_name?.trim() || null,
            provider: session?.provider ?? row?.provider ?? 'unknown',
            model: row?.model ?? null,
            state,
            reason: working ? null : (attention?.reason ?? null),
            lastReply,
        };
        const detail = attention?.detail ?? null;
        if (state === 'waiting') {
            const question = readString(detail?.question) || readString(detail?.excerpt);
            if (question)
                item.question = clip(question, 1000);
        }
        if (state === 'failed') {
            const error = readString(detail?.error);
            if (error)
                item.error = clip(error, 500);
        }
        return item;
    }
    function startRun(input) {
        const control = requireRunControl();
        try {
            return control.start(input);
        }
        catch (error) {
            console.error('[Threads] Run failed to start', {
                sessionId: input.sessionId,
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }
    // --- tools ---------------------------------------------------------------
    async function spawnThread(token, input) {
        await ensureRegistry();
        // Everything from here to the reservation is synchronous: parallel calls
        // cannot all pass the limit before any of them has started its thread.
        const owner = authorize(token);
        const prompt = readString(input.prompt);
        if (!prompt)
            refuse('PROMPT_REQUIRED', 'Нужна задача для треда (prompt)', 400);
        const parentLink = sessionLinksDb.getRow(owner.sessionId);
        if (parentLink?.relation === 'thread' && parentLink.parent_session_id) {
            refuse('NESTED_THREAD', 'Тред не может открывать свои треды — вернись с итогом к родителю', 403);
        }
        const working = sessionThreadsDb.listByParent(owner.sessionId).filter((row) => isProcessingNow(row.thread_session_id)).length;
        const opening = openingByParent.get(owner.sessionId) ?? 0;
        if (working + opening >= MAX_WORKING_THREADS) {
            refuse('THREAD_LIMIT', `Уже работают или открываются ${working + opening} треда из ${MAX_WORKING_THREADS} — дождись, пока какой-нибудь закончит (thread_status с wait), или останови его`, 429);
        }
        // The place is held until the thread's run has started (then it counts as
        // working) or the attempt failed.
        openingByParent.set(owner.sessionId, opening + 1);
        try {
            return await openThread(owner, prompt, input);
        }
        finally {
            const left = (openingByParent.get(owner.sessionId) ?? 1) - 1;
            if (left > 0)
                openingByParent.set(owner.sessionId, left);
            else
                openingByParent.delete(owner.sessionId);
        }
    }
    async function openThread(owner, prompt, input) {
        const { provider, model } = await resolveEngine(readString(input.provider), readString(input.model));
        if (provider === 'claude' && !isLocalModel(model)) {
            const guard = await checkClaudeLimit();
            if (guard.blocked) {
                refuse('CLAUDE_LIMIT', `Тред на Claude не открыт: 5-часовой лимит подписки почти исчерпан. ${guard.notice ?? ''} Открой тред на grok или local.`.trim(), 429);
            }
        }
        const parent = sessionsDb.getSessionById(owner.sessionId);
        const projectPath = parent?.project_path ?? '';
        if (!projectPath)
            refuse('PROJECT_REQUIRED', 'У чата нет проекта — тред открыть негде', 400);
        const user = { id: owner.userId };
        try {
            assertCanLinkNewChild({ parentSessionId: owner.sessionId, relation: 'thread', projectPath, user });
        }
        catch (error) {
            refuse('ACCESS_DENIED', error instanceof Error ? error.message : 'Нет доступа', 403);
        }
        const { sessionsService } = await import('../../modules/providers/services/sessions.service.js');
        const created = sessionsService.createAppSession(provider, projectPath);
        const threadId = created.sessionId;
        const title = clip(readString(input.title) || titleFromPrompt(prompt), TITLE_MAX);
        const stamp = now().toISOString();
        try {
            linkSession({ childSessionId: threadId, parentSessionId: owner.sessionId, relation: 'thread', user });
            sessionsDb.updateSessionCustomName(threadId, title);
            sessionThreadsDb.insert({
                thread_session_id: threadId,
                parent_session_id: owner.sessionId,
                user_id: owner.userId,
                provider,
                model,
                permission_mode: owner.permissionMode,
                created_at: stamp,
                started_at: stamp,
                seen_at: null,
                notified_at: null,
            });
        }
        catch (error) {
            sessionThreadsDb.delete(threadId);
            sessionsDb.deleteSessionById(threadId);
            throw error;
        }
        const options = { model, projectPath };
        if (owner.permissionMode)
            options.permissionMode = owner.permissionMode;
        // Local models spend no subscription: the 5-hour guard is not theirs.
        if (isLocalModel(model))
            options.usageGuardOverride = true;
        const started = startRun({ sessionId: threadId, userId: owner.userId, parentSessionId: owner.sessionId, content: prompt, options });
        if (!started) {
            sessionThreadsDb.delete(threadId);
            sessionsDb.deleteSessionById(threadId);
            refuse('RUN_NOT_STARTED', 'Тред создан, но прогон не запустился — попробуй ещё раз', 500);
        }
        broadcastUpsert(threadId);
        broadcastUpsert(owner.sessionId);
        return { threadId, title, provider, model, state: 'working' };
    }
    async function threadStatus(token, input) {
        const owner = authorize(token);
        await ensureRegistry();
        const targets = input.threadId !== undefined && input.threadId !== null && input.threadId !== ''
            ? [ownThread(owner, input.threadId).thread_session_id]
            : sessionThreadsDb.listByParent(owner.sessionId).map((row) => row.thread_session_id);
        const requested = Number(input.wait);
        const waitMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_THREAD_WAIT_SEC) * 1000 : 0;
        const deadline = now().getTime() + waitMs;
        const anyWorking = () => targets.some((id) => isProcessingNow(id));
        while (waitMs > 0 && anyWorking() && now().getTime() < deadline) {
            await sleep(Math.min(pollMs, Math.max(0, deadline - now().getTime())));
        }
        const threads = await Promise.all(targets.map((id) => statusOf(id)));
        const settled = threads.filter((thread) => thread.state !== 'working').map((thread) => thread.threadId);
        sessionThreadsDb.markSeen(settled, now().toISOString());
        const working = threads.length - settled.length;
        return { threads, working, timedOut: waitMs > 0 && working > 0 };
    }
    async function messageThread(token, input) {
        const owner = authorize(token);
        await ensureRegistry();
        const row = ownThread(owner, input.threadId);
        const text = readString(input.text);
        if (!text)
            refuse('TEXT_REQUIRED', 'Нужен текст сообщения для треда (text)', 400);
        if (isProcessingNow(row.thread_session_id)) {
            refuse('THREAD_BUSY', 'Тред занят — дождись конца его хода (thread_status с wait) или останови его (stop_thread)', 409);
        }
        const options = {};
        if (row.model)
            options.model = row.model;
        if (row.permission_mode)
            options.permissionMode = row.permission_mode;
        if (row.model && isLocalModel(row.model))
            options.usageGuardOverride = true;
        const started = startRun({
            sessionId: row.thread_session_id,
            userId: owner.userId,
            parentSessionId: owner.sessionId,
            content: text,
            options,
        });
        if (!started)
            refuse('THREAD_BUSY', 'Тред занят — сообщение не отправлено', 409);
        sessionThreadsDb.markStarted(row.thread_session_id, now().toISOString());
        return { threadId: row.thread_session_id, state: 'working' };
    }
    async function stopThread(token, input) {
        const owner = authorize(token);
        await ensureRegistry();
        const row = ownThread(owner, input.threadId);
        if (!isProcessingNow(row.thread_session_id)) {
            return { threadId: row.thread_session_id, stopped: false };
        }
        const stopped = await requireRunControl().abort(row.thread_session_id, owner.userId);
        return { threadId: row.thread_session_id, stopped };
    }
    async function callTool(token, name, input) {
        switch (name) {
            case 'spawn_thread': return spawnThread(token, input);
            case 'thread_status': return threadStatus(token, input);
            case 'message_thread': return messageThread(token, input);
            case 'stop_thread': return stopThread(token, input);
            default: return refuse('UNKNOWN_TOOL', `Нет такого инструмента: ${name}`, 404);
        }
    }
    // --- «Треды готовы» --------------------------------------------------------
    function describeForParent(item, index) {
        const head = `${index + 1}. «${item.title ?? 'Тред'}» (${item.provider}${item.model ? ` · ${item.model}` : ''})`;
        if (item.state === 'failed') {
            return `${head} — ошибка: ${clip(item.error ?? 'прогон не удался', SUMMARY_REPLY_MAX)}`;
        }
        if (item.state === 'waiting') {
            return `${head} — ждёт ответа: ${clip(item.question ?? item.lastReply ?? 'вопрос в чате треда', SUMMARY_REPLY_MAX)}`;
        }
        return `${head} — готово: ${item.lastReply ? clip(item.lastReply, SUMMARY_REPLY_MAX) : 'без текста ответа'}`;
    }
    /** Running, or waiting for a human (a question, a plan, an approval, a question in text). */
    function parentIsBusy(parentSessionId) {
        if (isProcessingNow(parentSessionId))
            return true;
        return attentionOf(parentSessionId)?.state === 'waiting';
    }
    async function notifyParentIfReady(parentSessionId) {
        if (notifying.has(parentSessionId) || !runControl)
            return;
        notifying.add(parentSessionId);
        try {
            if (parentIsBusy(parentSessionId))
                return;
            const pending = sessionThreadsDb.listByParent(parentSessionId)
                .filter((row) => row.seen_at === null && row.notified_at === null);
            if (pending.length === 0)
                return;
            if (pending.some((row) => isProcessingNow(row.thread_session_id)))
                return;
            const items = await Promise.all(pending.map((row) => statusOf(row.thread_session_id)));
            if (items.some((item) => item.state === 'working') || parentIsBusy(parentSessionId))
                return;
            const content = [
                'Треды готовы:',
                ...items.map(describeForParent),
                '',
                'Полные ответы — thread_status; дописать в тред — message_thread.',
            ].join('\n');
            const options = {};
            const mode = pending[pending.length - 1].permission_mode;
            if (mode)
                options.permissionMode = mode;
            // Synchronous start: nothing can slip in before the batch is marked.
            // Not started (someone wrote to the parent meanwhile) → the batch waits
            // for the end of that run.
            const started = startRun({
                sessionId: parentSessionId,
                userId: pending[0].user_id,
                parentSessionId,
                content,
                options,
            });
            if (started) {
                sessionThreadsDb.markNotified(pending.map((row) => row.thread_session_id), now().toISOString());
            }
        }
        finally {
            notifying.delete(parentSessionId);
        }
    }
    /** Any status change: a thread settled, or a parent finished its turn. */
    async function handleAttentionChange(sessionId) {
        try {
            await ensureRegistry();
            const asThread = sessionThreadsDb.get(sessionId);
            if (asThread) {
                await notifyParentIfReady(asThread.parent_session_id);
                return;
            }
            if (sessionThreadsDb.listByParent(sessionId).length > 0) {
                await notifyParentIfReady(sessionId);
            }
        }
        catch (error) {
            console.error('[Threads] «Треды готовы» check failed', {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return {
        spawnThread,
        threadStatus,
        messageThread,
        stopThread,
        callTool,
        handleAttentionChange,
        setRunControl(control) {
            runControl = control;
        },
    };
}
export const threadsService = createThreadsService();
//# sourceMappingURL=threads.service.js.map
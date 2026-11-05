import { agentsService, type AgentsService } from '@/modules/agents/index.js';
import { isModOn as defaultIsModOn, modOffMessage, type IsModOn } from '@/shared/mods.js';
import { AppError } from '@/shared/utils.js';

import type { WorkspaceSource } from '../../../shared/agent-workspace.js';
import type { MailDraftInput } from '../../../shared/agent-mail.js';
import { createMailService, type MailOptions } from '../agent-mail/index.js';
import { getArtifactsService, type ArtifactsService } from '../artifacts/index.js';
import { getSettingsProfileService, type SettingsProfileService } from '../settings-profile/index.js';
import { getSidebarGroupsService, type SidebarGroupsService } from '../sidebar-groups/index.js';
import { createDocumentsService } from '../managed-documents/index.js';
import { createTeamService } from '../workspace-team/index.js';

import type { WorkspaceDependencies } from './dependencies.js';
import { requireWorkspaceProject, createDailyService } from './service.js';
import { WorkspaceError } from './store.js';
/** «Браузер вживую»: the chat's own page of the invisible Neo3 browser (`browser.*`, `safari.show`). */
export type BrowserTool = { run(userId: number, sessionId: string, action: string, data: Record<string, unknown>): Promise<unknown> };
/** «Агенты»: what `agent.list` / `agent.remember` need from the agents service. */
export type AgentsTool = Pick<AgentsService, 'list' | 'addRule' | 'agentOfSession'>;
/** «Запрос ключа»: the agent asks for a secret by name and waits for Dima's answer (never the value). */
export type SecretRequestsTool = { request(userId: number, sessionId: string, input: { name: string; why: string }): Promise<unknown> };
export type WorkspaceToolsOptions = MailOptions & { artifacts?: ArtifactsService; groups?: SidebarGroupsService; profile?: SettingsProfileService; browser?: BrowserTool; agents?: AgentsTool; secretRequests?: SecretRequestsTool; isModOn?: IsModOn };
/** Production browser actions, loaded on first use (the module owns the helper process). */
const defaultBrowser: BrowserTool = {
    run: async (userId, sessionId, action, data) => (await import('../safari-live/index.js')).runBrowserAction(userId, sessionId, action, data),
};
/** Actions delegated to the browser; `safari.show` is the older name of `browser.open`. */
const BROWSER_ACTIONS = new Set(['browser.open', 'browser.click', 'browser.type', 'browser.press', 'browser.scroll', 'browser.read', 'browser.eval', 'browser.wait', 'browser.screenshot', 'browser.close', 'safari.show']);
/** Only the fields browser actions read (never projectId/sessionId: the chat is the caller's). */
const BROWSER_FIELDS = ['url', 'pageId', 'windowId', 'selector', 'text', 'x', 'y', 'key', 'dy', 'format', 'max', 'js', 'ms', 'submit'];
/** Production `secret.request`, loaded on first use (requests live in that module's memory). */
const defaultSecretRequests: SecretRequestsTool = {
    request: async (userId, sessionId, input) => (await import('../secret-requests/index.js')).secretRequestsService.request(userId, sessionId, input),
};
/** Same for the services that throw AppError synchronously (groups, settings profile). */
const sync = <T>(run: () => T): T => {
    try {
        return run();
    }
    catch (error) {
        return asWorkspaceError(error);
    }
};
/** Artifact refusals (AppError) keep their status for the agent, like every workspace refusal. */
const asWorkspaceError = (error: unknown): never => {
    if (error instanceof AppError) throw new WorkspaceError(error.message, error.statusCode);
    throw error;
};
/**
 * Narrow agent surface: no approval, transport, mailbox enumeration or syncing.
 * `group.*` / `pin.set` only arrange the sidebar (no deletes); `settings.propose` only suggests.
 * `artifact.publish` only shows a file of the chat project in the Neo3 canvas
 * (the source is this chat); nothing leaves the machine.
 * `browser.*` drive this chat's page of the invisible Neo3 browser, shown live in its canvas (admin only).
 * `secret.request` asks Dima for a secret by NAME and waits (≤ 10 min); the answer is the name or «отказал», never the value (admin only).
 */
export function createWorkspaceTools(deps: WorkspaceDependencies, options: WorkspaceToolsOptions = {}) {
    const documents = createDocumentsService(deps), team = createTeamService(deps), daily = createDailyService(deps);
    const artifacts = () => options.artifacts ?? getArtifactsService();
    const groups = () => options.groups ?? getSidebarGroupsService();
    const profile = () => options.profile ?? getSettingsProfileService();
    const browser = () => options.browser ?? defaultBrowser;
    const agents = () => options.agents ?? agentsService;
    const secretRequests = () => options.secretRequests ?? defaultSecretRequests;
    /** Agents are admin-only and switchable: the other users and a switched-off mod get a plain refusal. */
    const agentsAllowed = (userId: number) => {
        if (!(options.isModOn ?? defaultIsModOn)(userId, 'modAgents'))
            throw new WorkspaceError(`${modOffMessage('modAgents')}. Агентов сейчас нет.`, 409);
        return deps.isAdmin(userId);
    };
    return {
        call(userId: number, sessionId: string, input: Record<string, unknown>): unknown {
            const projectId = deps.sessionProject?.(userId, sessionId);
            if (!projectId)
                throw new WorkspaceError('Нет доступа к чату проекта', 403);
            requireWorkspaceProject(deps, userId, projectId);
            const id = typeof input.id === 'string' ? input.id : '';
            const data = (input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data : {}) as Record<string, unknown>;
            const revision = Number(input.revision);
            const scoped = () => {
                const row = deps.store.get(id);
                if (!row || row.projectId !== projectId)
                    throw new WorkspaceError('Источник не из текущего проекта', 403);
            };
            const mailGrant = (sourceId: string) => {
                const grants = deps.store.list<{
                    source: WorkspaceSource;
                    sessionId: string;
                }>('workspace-handoff', { ownerUserId: userId, projectId });
                if (!grants.some(g => g.payload.sessionId === sessionId && g.payload.source.kind === 'mail-message' && g.payload.source.id === sourceId))
                    throw new WorkspaceError('Сначала передайте это письмо в этот чат', 403);
                const mail = createMailService(deps, options);
                mail.read(userId, sourceId); // Mailbox ownership is re-read on every use.
                return mail;
            };
            if (typeof input.action === 'string' && BROWSER_ACTIONS.has(input.action)) {
                const picked: Record<string, unknown> = {};
                for (const field of BROWSER_FIELDS) if (data[field] !== undefined) picked[field] = data[field];
                return browser().run(userId, sessionId, input.action, picked).catch(asWorkspaceError);
            }
            switch (input.action) {
                case 'document.list': return documents.list(userId, projectId);
                case 'document.read':
                    scoped();
                    return documents.detail(userId, id);
                case 'document.create': return documents.create(userId, { projectId, type: 'document', title: data.title as string, text: data.text as string });
                case 'document.revise':
                    scoped();
                    return documents.revise(userId, id, revision, { title: data.title as string, text: data.text as string });
                case 'knowledge.search': return documents.search(userId, projectId, data.query as string);
                case 'assignment.list': return team.listAssignments(userId, projectId);
                case 'assignment.read':
                    scoped();
                    return team.getAssignment(userId, id);
                case 'assignment.create': return team.createAssignment(userId, { projectId, assigneeId: Number(data.assigneeId), title: data.title as string, body: data.body as string, dueAt: (data.dueAt ?? null) as string | null, attachments: [] });
                case 'assignment.update':
                    scoped();
                    return team.updateAssignment(userId, id, revision, { status: data.status as 'open' | 'in_progress' | 'done' });
                case 'project.users': return team.users(userId, projectId);
                case 'task.create': return daily.create(userId, { title: data.title as string, dueAt: (data.dueAt ?? null) as string | null, priority: Number(data.priority ?? 0), completed: false });
                case 'mail.read': return mailGrant(id).read(userId, id);
                case 'mail.draft': {
                    const sourceId = typeof data.replyToId === 'string' ? data.replyToId : '';
                    return mailGrant(sourceId).create(userId, data as unknown as MailDraftInput);
                }
                case 'artifact.publish':
                    return artifacts().publish(userId, projectId, { path: data.path, title: data.title, sessionId }).catch(asWorkspaceError);
                case 'artifact.list':
                    return artifacts().list(userId, projectId).catch(asWorkspaceError);
                // Groups: ordering only. No delete of groups, chats or projects exists here.
                case 'group.list': return sync(() => groups().list(userId));
                case 'group.create': return sync(() => groups().create(userId, { name: data.name }));
                case 'group.rename': return sync(() => groups().update(userId, data.id ?? id, { name: data.name }));
                case 'group.add': return sync(() => groups().addItem(userId, data.id ?? id, data.itemType, data.itemId));
                case 'group.remove': return sync(() => groups().removeItem(userId, data.id ?? id, data.itemType, data.itemId));
                case 'pin.set': return sync(() => groups().setPin(userId, data.sessionId ?? sessionId, data.pinned !== false));
                // A suggestion only: the person applies it in «Настройки → Профиль настроек».
                case 'settings.propose': return sync(() => profile().propose(userId, sessionId, { changes: data.changes, reason: data.reason }));
                // The team of the owner: names, first line of the role, engine — to pick helpers for spawn_thread{agent}.
                case 'agent.list': {
                    if (!agentsAllowed(userId))
                        return { agents: [], note: 'Агентами управляет только администратор — у этого пользователя их нет' };
                    return { agents: sync(() => agents().list(userId)).map(agent => ({ name: agent.name, role: agent.role.split('\n')[0].trim().slice(0, 120), provider: agent.provider, model: agent.model })) };
                }
                // A rule for the agent of THIS chat; it reaches every next chat of that agent.
                case 'agent.remember': {
                    if (!agentsAllowed(userId))
                        throw new WorkspaceError('Память агентов ведёт только администратор', 403);
                    const agent = agents().agentOfSession(sessionId);
                    if (!agent)
                        throw new WorkspaceError('Этот чат не привязан к агенту — запоминать некуда', 404);
                    const rule = typeof data.text === 'string' ? data.text.trim() : '';
                    if (!rule)
                        throw new WorkspaceError('Нужен текст правила: data.text', 400);
                    const memory = sync(() => agents().addRule(userId, agent.id, rule, 'agent'));
                    return { message: `Правило добавлено, версия V${memory.version}`, agent: agent.name, version: memory.version };
                }
                // Dima types the value into «Ждут тебя»; it goes only to the secrets file. The agent hears the name.
                case 'secret.request': {
                    const name = typeof data.name === 'string' ? data.name : '';
                    const why = typeof data.why === 'string' ? data.why : '';
                    return secretRequests().request(userId, sessionId, { name, why }).catch(asWorkspaceError);
                }
                default: throw new WorkspaceError('Операция недоступна агенту: отправку, согласование и публикацию выполняет человек в интерфейсе', 403);
            }
        },
    };
}

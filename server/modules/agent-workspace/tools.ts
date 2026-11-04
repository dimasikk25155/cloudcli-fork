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
/** «Safari вживую»: binds the agent's Safari window to its chat (`safari.show`). */
export type SafariLiveTool = { show(userId: number, sessionId: string, data: Record<string, unknown>): Promise<unknown> };
export type WorkspaceToolsOptions = MailOptions & { artifacts?: ArtifactsService; groups?: SidebarGroupsService; profile?: SettingsProfileService; safariLive?: SafariLiveTool };
/** Production `safari.show`, loaded on first use (the module owns helper processes). */
const defaultSafariLive: SafariLiveTool = {
    show: async (userId, sessionId, data) => (await import('../safari-live/index.js')).showForAgent(userId, sessionId, data),
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
 * `safari.show` opens a page in the agent's own Safari window (or binds an open one) and shows it in this chat (admin only).
 */
export function createWorkspaceTools(deps: WorkspaceDependencies, options: WorkspaceToolsOptions = {}) {
    const documents = createDocumentsService(deps), team = createTeamService(deps), daily = createDailyService(deps);
    const artifacts = () => options.artifacts ?? getArtifactsService();
    const groups = () => options.groups ?? getSidebarGroupsService();
    const profile = () => options.profile ?? getSettingsProfileService();
    const safariLive = () => options.safariLive ?? defaultSafariLive;
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
                // Shows the agent's Safari window to the user live on the canvas; never brings Safari to the front.
                case 'safari.show': {
                    const picked: Record<string, unknown> = {};
                    if (typeof data.url === 'string') picked.url = data.url;
                    if (typeof data.windowId === 'number' || typeof data.windowId === 'string') picked.windowId = data.windowId;
                    if (typeof data.titleContains === 'string') picked.titleContains = data.titleContains;
                    return safariLive().show(userId, sessionId, picked).catch(asWorkspaceError);
                }
                default: throw new WorkspaceError('Операция недоступна агенту: отправку, согласование и публикацию выполняет человек в интерфейсе', 403);
            }
        },
    };
}

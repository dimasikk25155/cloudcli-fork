import type { WorkspaceSource } from '../../../shared/agent-workspace.js';
import type { MailDraftInput } from '../../../shared/agent-mail.js';
import { createMailService, type MailOptions } from '../agent-mail/index.js';
import { createDocumentsService } from '../managed-documents/index.js';
import { createTeamService } from '../workspace-team/index.js';

import type { WorkspaceDependencies } from './dependencies.js';
import { requireWorkspaceProject, createDailyService } from './service.js';
import { WorkspaceError } from './store.js';
/** Narrow agent surface: no approval, transport, publishing, mailbox enumeration or syncing. */
export function createWorkspaceTools(deps: WorkspaceDependencies, options: MailOptions = {}) {
    const documents = createDocumentsService(deps), team = createTeamService(deps), daily = createDailyService(deps);
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
                default: throw new WorkspaceError('Операция недоступна агенту: отправку, согласование и публикацию выполняет человек в интерфейсе', 403);
            }
        },
    };
}

import type { WorkspaceHandoff } from '../../../shared/agent-workspace';
export const WORKSPACE_CHAT_EVENT = 'neo3:workspace-chat';
export const HANDOFF_STORAGE_PREFIX = 'neo3:workspace-handoff:';
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readWorkspaceHandoffs(projectId: string, storage: Pick<Storage, 'getItem'>): WorkspaceHandoff[] {
    const raw = storage.getItem(HANDOFF_STORAGE_PREFIX + projectId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Preserve drafts staged by the previous single-material format.
    const handoffs = Array.isArray(parsed) ? parsed : [parsed];
    if (handoffs.some(item => !item || item.projectId !== projectId || typeof item.grantId !== 'string' || !item.grantId)) {
        throw new Error('Некорректная передача материала');
    }
    return handoffs;
}

export function stageWorkspaceHandoff(handoff: WorkspaceHandoff, drafts: Pick<Storage, 'getItem' | 'setItem'>, pending: Pick<Storage, 'getItem' | 'setItem'>) {
    const handoffs = readWorkspaceHandoffs(handoff.projectId, pending);
    const key = 'draft_input_' + handoff.projectId;
    const previous = drafts.getItem(key) || '';
    drafts.setItem(key, previous ? previous + '\n\n' + handoff.text : handoff.text);
    pending.setItem(HANDOFF_STORAGE_PREFIX + handoff.projectId, JSON.stringify([...handoffs, handoff]));
}

export async function bindPendingWorkspaceHandoffs(projectId: string, sessionId: string, storage: PendingStorage, bind: (grantId: string, sessionId: string) => Promise<unknown>) {
    const handoffs = readWorkspaceHandoffs(projectId, storage);
    while (handoffs.length) {
        await bind(handoffs[0].grantId!, sessionId);
        handoffs.shift();
        // A later failure must not rebind successful grants to a different chat.
        if (handoffs.length) storage.setItem(HANDOFF_STORAGE_PREFIX + projectId, JSON.stringify(handoffs));
        else storage.removeItem(HANDOFF_STORAGE_PREFIX + projectId);
    }
}

export function cancelPendingWorkspaceHandoffs(projectId: string, storage: Pick<Storage, 'removeItem'>) {
    storage.removeItem(HANDOFF_STORAGE_PREFIX + projectId);
}

export function selectHandoffProject<T extends {
    projectId?: string;
}>(projects: T[], projectId: string, open: (project: T) => void) {
    const project = projects.find(p => p.projectId === projectId);
    if (!project)
        throw new Error('Проект не найден в доступных проектах');
    open(project);
}

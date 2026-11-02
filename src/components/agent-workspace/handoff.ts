import type { WorkspaceHandoff } from '../../../shared/agent-workspace';
export const WORKSPACE_CHAT_EVENT = 'neo3:workspace-chat';
export const HANDOFF_STORAGE_PREFIX = 'neo3:workspace-handoff:';
export function stageWorkspaceHandoff(handoff: WorkspaceHandoff, drafts: Pick<Storage, 'getItem' | 'setItem'>, pending: Pick<Storage, 'setItem'>) {
    const key = 'draft_input_' + handoff.projectId;
    const previous = drafts.getItem(key) || '';
    drafts.setItem(key, previous ? previous + '\n\n' + handoff.text : handoff.text);
    pending.setItem(HANDOFF_STORAGE_PREFIX + handoff.projectId, JSON.stringify(handoff));
}
export function selectHandoffProject<T extends {
    projectId?: string;
}>(projects: T[], projectId: string, open: (project: T) => void) {
    const project = projects.find(p => p.projectId === projectId);
    if (!project)
        throw new Error('Проект не найден в доступных проектах');
    open(project);
}

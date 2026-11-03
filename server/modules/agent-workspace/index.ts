export { createWorkspaceStore, WorkspaceError } from './store.js';
export type { WorkspaceStore } from './store.js';
export type { WorkspaceDependencies, WorkspaceFeatures, HandoffResolver } from './dependencies.js';
export { createDailyService, requireWorkspaceUser, requireWorkspaceProject, resolveWorkspaceHandoff } from './service.js';
export { createWorkspaceRouter, workspaceHandler, workspaceUserId } from './routes.js';
export async function callWorkspaceTool(userId: number, sessionId: string, input: Record<string, unknown>) {
    const { workspaceDependencies } = await import('./runtime.js');
    const { createWorkspaceTools } = await import('./tools.js');
    return createWorkspaceTools(workspaceDependencies).call(userId, sessionId, input);
}
export { workspaceSessionHasGrant } from './runtime.js';

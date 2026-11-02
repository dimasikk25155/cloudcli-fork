export interface WorkspaceRecord<T = Record<string, unknown>> { id: string; kind: string; ownerUserId: number; projectId: string | null; revision: number; payload: T; createdAt: string; updatedAt: string }
export interface WorkspaceProject { id: string; name: string; path: string }
export interface WorkspaceUser { id: number; username: string }
export interface WorkspaceSource { kind: string; id: string; version?: string; selection?: string }
export interface WorkspaceHandoff { projectId: string; projectPath: string; source: WorkspaceSource; text: string }
export interface DailyTask { title: string; dueAt: string | null; priority: number; completed: boolean }
export interface WorkspacePanelProps { projectId: string; onClose?: () => void }

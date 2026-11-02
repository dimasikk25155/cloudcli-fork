import type { Router } from 'express';

import type { WorkspaceHandoff, WorkspaceProject, WorkspaceSource, WorkspaceUser } from '../../../shared/agent-workspace.js';

import type { WorkspaceStore } from './store.js';
export type HandoffResolver = (input: {userId:number;projectId:string;source:WorkspaceSource}) => Promise<{text:string;version?:string}> | {text:string;version?:string};
export interface WorkspaceDependencies {
 store: WorkspaceStore;
 now(): string;
 canAccessProject(userId: number, projectId: string): boolean;
 isAdmin(userId:number): boolean;
 getUser(id:number): WorkspaceUser | null;
 listUsers(): WorkspaceUser[];
 getProject(id:string): WorkspaceProject | null;
 listProjects(userId:number): WorkspaceProject[];
 handoffs: Map<string,HandoffResolver>;
 fetch?: typeof fetch;
}
export interface WorkspaceFeatures { mail?: Router; documents?: Router; team?: Router }
export type { WorkspaceHandoff };

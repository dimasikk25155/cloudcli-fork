import { Router } from 'express';

import { createMailRouter, registerMailHandoff } from '../agent-mail/index.js';
import { createDocumentsRouter, registerDocumentHandoff } from '../managed-documents/index.js';
import { createTeamRouter, createPublicIntakeRouter, registerTeamHandoff } from '../workspace-team/index.js';
import { getConnection, projectsDb, userDb, sessionsDb } from '../database/index.js';
import { projectAccessFor, isAdminUser, canAccessSession } from '../../shared/project-access.js';

import { hasWorkspaceSessionGrant } from './service.js';
import type { WorkspaceDependencies } from './dependencies.js';
import { createWorkspaceStore } from './store.js';
import { createWorkspaceRouter } from './routes.js';
const project = (r: ReturnType<typeof projectsDb.getProjectById>) => r ? { id: r.project_id, path: r.project_path, name: r.custom_project_name || r.project_path } : null;
// Construct the repository only on first use, after the server bootstrap has
// loaded DATABASE_PATH and initialized the application's database. Imports stay inert.
let workspaceStore: ReturnType<typeof createWorkspaceStore> | undefined;
export const workspaceDependencies: WorkspaceDependencies = {
    get store() { return workspaceStore ??= createWorkspaceStore(getConnection()); },
    now: () => new Date().toISOString(),
    canAccessProject: (id, p) => projectAccessFor({ id })(p), isAdmin: id => isAdminUser({ id }),
    getUser: id => { const u = userDb.getUserById(id); return u ? { id: u.id, username: u.username } : null; },
    listUsers: () => userDb.listUsers().filter(u => u.is_active).map(u => ({ id: u.id, username: u.username })),
    getProject: id => project(projectsDb.getProjectById(id)),
    listProjects: id => { const access = projectAccessFor({ id }); return projectsDb.getProjectPaths().filter(p => access(p.project_id)).map(p => project(p)!); },
    handoffs: new Map(),
    sessionProject(userId, sessionId) {
        if (!canAccessSession({ id: userId }, sessionId))
            return null;
        const session = sessionsDb.getSessionById(sessionId);
        return session?.project_path ? projectsDb.getProjectPath(session.project_path)?.project_id ?? null : null;
    },
};
// Initialization is deferred until the first request, after environment and DB bootstrap.
let composed: ReturnType<typeof composeWorkspace> | undefined;
export function composeWorkspace() {
    registerMailHandoff(workspaceDependencies);
    registerDocumentHandoff(workspaceDependencies);
    registerTeamHandoff(workspaceDependencies);
    return {
        staff: createWorkspaceRouter(workspaceDependencies, {
            mail: createMailRouter(workspaceDependencies),
            documents: createDocumentsRouter(workspaceDependencies),
            team: createTeamRouter(workspaceDependencies),
        }),
        public: createPublicIntakeRouter(workspaceDependencies),
    };
}
function routes() { return composed ??= composeWorkspace(); }
export const workspaceRoutes = Router();
workspaceRoutes.use((req, res, next) => routes().staff(req, res, next));
export const publicIntakeRoutes = Router();
publicIntakeRoutes.use((req, res, next) => routes().public(req, res, next));
export function workspaceSessionHasGrant(userId: number, sessionId: string) {
    return hasWorkspaceSessionGrant(workspaceDependencies, userId, sessionId);
}

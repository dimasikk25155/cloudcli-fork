import { Router } from 'express';

import { getConnection, projectsDb, userDb } from '../database/index.js';
import { projectAccessFor, isAdminUser } from '../../shared/project-access.js';

import type { WorkspaceDependencies } from './dependencies.js';
import { createWorkspaceStore } from './store.js';
import { createWorkspaceRouter } from './routes.js';
const project=(r:ReturnType<typeof projectsDb.getProjectById>)=>r?{id:r.project_id,path:r.project_path,name:r.custom_project_name||r.project_path}:null;
export const workspaceDependencies:WorkspaceDependencies={
 store:createWorkspaceStore(getConnection()),now:()=>new Date().toISOString(),
 canAccessProject:(id,p)=>projectAccessFor({id})(p),isAdmin:id=>isAdminUser({id}),
 getUser:id=>{const u=userDb.getUserById(id);return u?{id:u.id,username:u.username}:null;},
 listUsers:()=>userDb.listUsers().filter(u=>u.is_active).map(u=>({id:u.id,username:u.username})),
 getProject:id=>project(projectsDb.getProjectById(id)),
 listProjects:id=>{const access=projectAccessFor({id});return projectsDb.getProjectPaths().filter(p=>access(p.project_id)).map(p=>project(p)!);},
 handoffs:new Map(),
};
// Ticket 05 composes feature routers here after their independent implementation.
export const workspaceRoutes=createWorkspaceRouter(workspaceDependencies);
export const publicIntakeRoutes=Router();
publicIntakeRoutes.use((_req,res)=>res.status(503).json({error:'Приём заявок ещё не подключён'}));

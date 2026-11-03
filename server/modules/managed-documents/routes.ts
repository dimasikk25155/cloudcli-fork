import { Router } from 'express';

import { workspaceHandler, workspaceUserId, type WorkspaceDependencies } from '../agent-workspace/index.js';

import { createDocumentsService } from './service.js';
export function createDocumentsRouter(deps:WorkspaceDependencies){
 const router=Router(),service=createDocumentsService(deps);
 router.get('/',workspaceHandler((req,res)=>res.json(service.list(workspaceUserId(req),String(req.query.projectId??'')))));
 router.get('/users',workspaceHandler((req,res)=>res.json(service.users(workspaceUserId(req),String(req.query.projectId??'')))));
 router.get('/search',workspaceHandler((req,res)=>res.json(service.search(workspaceUserId(req),String(req.query.projectId??''),String(req.query.q??'')))));
 router.post('/',workspaceHandler((req,res)=>res.status(201).json(service.create(workspaceUserId(req),req.body))));
 router.get('/:id',workspaceHandler((req,res)=>res.json(service.detail(workspaceUserId(req),String(req.params.id)))));
 router.get('/:id/compare',workspaceHandler((req,res)=>res.json(service.compare(workspaceUserId(req),String(req.params.id),String(req.query.left),String(req.query.right)))));
 router.post('/:id/revisions',workspaceHandler((req,res)=>res.json(service.revise(workspaceUserId(req),String(req.params.id),req.body.revision,req.body))));
 router.post('/:id/approve-template',workspaceHandler((req,res)=>res.json(service.approveTemplate(workspaceUserId(req),String(req.params.id),req.body.revision,req.body.versionId))));
 router.post('/:id/instantiate',workspaceHandler((req,res)=>res.status(201).json(service.instantiate(workspaceUserId(req),String(req.params.id),req.body.versionId,req.body.values,req.body.title))));
 router.post('/:id/restore',workspaceHandler((req,res)=>res.json(service.restore(workspaceUserId(req),String(req.params.id),req.body.revision,req.body.versionId))));
 router.post('/:id/approval',workspaceHandler((req,res)=>res.json(service.startApproval(workspaceUserId(req),String(req.params.id),req.body.revision,req.body.versionId,req.body.actors))));
 router.post('/:id/approve',workspaceHandler((req,res)=>res.json(service.approve(workspaceUserId(req),String(req.params.id),req.body.revision,req.body.versionId))));
 router.post('/:id/knowledge',workspaceHandler((req,res)=>res.json(service.knowledge(workspaceUserId(req),String(req.params.id),req.body.revision,req.body.enabled))));
 return router;
}

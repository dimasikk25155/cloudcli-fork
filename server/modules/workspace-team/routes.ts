import { Router, json, type ErrorRequestHandler } from 'express';

import { requireWorkspaceUser, workspaceHandler, workspaceUserId, WorkspaceError, type WorkspaceDependencies } from '../agent-workspace/index.js';

import { createAssignments } from './service.js';
import { createIntake } from './intake.js';
export function createTeamRouter(deps:WorkspaceDependencies) {
 const router=Router(),team=createAssignments(deps),intake=createIntake(deps);
 router.use((req,res,next)=>{try{requireWorkspaceUser(deps,workspaceUserId(req));next();}catch(e){if(e instanceof WorkspaceError)res.status(e.statusCode).json({error:e.message});else next(e);}});
 router.get('/users',workspaceHandler((req,res)=>res.json(team.users(workspaceUserId(req),String(req.query.projectId??'')))));
 router.get('/assignments',workspaceHandler((req,res)=>res.json(team.listAssignments(workspaceUserId(req),String(req.query.projectId??'')))));
 router.get('/notifications',workspaceHandler((req,res)=>res.json(team.notifications(workspaceUserId(req),String(req.query.projectId??'')))));
 router.post('/assignments',workspaceHandler((req,res)=>res.status(201).json(team.createAssignment(workspaceUserId(req),req.body))));
 router.patch('/assignments/:id',workspaceHandler((req,res)=>{const {revision,...patch}=req.body;res.json(team.updateAssignment(workspaceUserId(req),String(req.params.id),revision,patch));}));
 router.get('/forms',workspaceHandler((req,res)=>res.json(intake.listForms(workspaceUserId(req),String(req.query.projectId??'')))));
 router.post('/forms',workspaceHandler((req,res)=>res.status(201).json(intake.createForm(workspaceUserId(req),req.body))));
 router.patch('/forms/:id',workspaceHandler((req,res)=>{const {revision,...patch}=req.body;res.json(intake.updateForm(workspaceUserId(req),String(req.params.id),revision,patch));}));
 router.get('/forms/:id/leads',workspaceHandler((req,res)=>res.json(intake.listLeads(workspaceUserId(req),String(req.params.id)))));
 router.post('/leads/:id/convert',workspaceHandler((req,res)=>res.json(intake.convertLead(workspaceUserId(req),String(req.params.id),req.body))));
 return router;
}
export function createPublicIntakeRouter(deps:WorkspaceDependencies) {
 const router=Router(),intake=createIntake(deps);
 // Bounded, process-local abuse buckets plus persistent 500-session/form cap; no forwarded IP trust.
 const buckets=new Map<string,{minute:number;count:number;hour:number;starts:number}>();let globalMinute=0,globalCount=0;
 router.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const now=Date.parse(deps.now()),minute=Math.floor(now/60000),hour=Math.floor(now/3600000);
  if(globalMinute!==minute){globalMinute=minute;globalCount=0;}
  if(++globalCount>1000){res.status(429).json({error:'Слишком много запросов'});return;}
  const key=req.socket.remoteAddress??'unknown';let bucket=buckets.get(key);
  if(!bucket){if(buckets.size>=10000)buckets.clear();bucket={minute,count:0,hour,starts:0};buckets.set(key,bucket);}
  if(bucket.minute!==minute){bucket.minute=minute;bucket.count=0;}if(bucket.hour!==hour){bucket.hour=hour;bucket.starts=0;}
  if(++bucket.count>60||(req.path==='/start'&&++bucket.starts>10)){res.status(429).json({error:'Слишком много запросов. Попробуйте позже'});return;}next();
 });
 router.use(json({limit:'12kb',strict:true}));
 const body=(value:unknown,keys:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>12000||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!(k in value)))throw new WorkspaceError('Некорректный запрос');};
 router.post('/start',workspaceHandler((req,res)=>{body(req.body,['formToken']);res.status(201).json(intake.start(req.body.formToken));}));
 router.post('/resume',workspaceHandler((req,res)=>{body(req.body,['sessionToken']);res.json(intake.resume(req.body.sessionToken));}));
 router.post('/answer',workspaceHandler((req,res)=>{body(req.body,['sessionToken','revision','fieldId','value']);res.json(intake.answer(req.body.sessionToken,req.body.revision,req.body.fieldId,req.body.value));}));
 const publicError:ErrorRequestHandler=(error,_req,res,_next)=>{const status=error?.type==='entity.too.large'?413:400;res.status(status).json({error:status===413?'Запрос слишком большой':'Некорректный запрос'});};
 router.use(publicError);
 router.use((_req,res)=>res.status(404).json({error:'Страница не найдена'}));
 return router;
}

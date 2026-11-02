import assert from 'node:assert/strict';
import { test } from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';

import { createWorkspaceStore, resolveWorkspaceHandoff, type WorkspaceDependencies } from '../../agent-workspace/index.js';
import { createTeamService, createTeamRouter, createPublicIntakeRouter  } from '../index.js';
function fixture() {
 const db = new Database(':memory:');db.exec('CREATE TABLE workspace_records (id TEXT PRIMARY KEY,kind TEXT,owner_user_id INTEGER,project_id TEXT,revision INTEGER,payload TEXT,created_at TEXT,updated_at TEXT)');
 const revoked=new Set<number>(); const deps:WorkspaceDependencies={store:createWorkspaceStore(db),now:()=> '2026-11-02T12:00:00.000Z',canAccessProject:(id,p)=>!revoked.has(id)&&p==='p'&&[1,2,3].includes(id),isAdmin:()=>false,getUser:id=>[1,2,3].includes(id)?{id,username:'User '+id}:null,listUsers:()=>[1,2,3].map(id=>({id,username:'User '+id})),getProject:id=>({id,name:'Project',path:'/tmp'}),listProjects:()=>[],handoffs:new Map()};
 return {db,deps,revoked,service:createTeamService(deps)};
}
test('assignment reaches only parties; both current grants govern inbox, mutations and receiver handoff',async()=>{
 const {db,deps,revoked,service}=fixture();
 try {
 const row=service.createAssignment(1,{projectId:'p',assigneeId:2,title:'Prepare brief',body:'Source',dueAt:'2026-11-03T12:00:00+03:00',attachments:[]});
 assert.equal(service.listAssignments(2,'p').length,1);assert.equal(service.listAssignments(3,'p').length,0);
 assert.equal(row.ownerUserId,1);assert.equal(row.payload.dueAt,'2026-11-03T09:00:00.000Z');
 assert.equal(service.notifications(2,'p').count,1);
 await assert.rejects(resolveWorkspaceHandoff(deps,3,{projectId:'p',source:{kind:'assignment',id:row.id}}));
 const handoff=await resolveWorkspaceHandoff(deps,2,{projectId:'p',source:{kind:'assignment',id:row.id}});assert.match(handoff.text,/Prepare brief/);
 assert.throws(()=>service.updateAssignment(3,row.id,1,{status:'done'}),/доступ/);
 service.updateAssignment(2,row.id,1,{status:'in_progress'});
 assert.throws(()=>service.updateAssignment(1,row.id,1,{status:'done'}),/изменён/);
 revoked.add(1);assert.equal(service.listAssignments(2,'p').length,0);
 assert.throws(()=>service.updateAssignment(2,row.id,2,{status:'done'}),/доступ/);
 await assert.rejects(resolveWorkspaceHandoff(deps,2,{projectId:'p',source:{kind:'assignment',id:row.id}}),/доступ/);
 }finally{db.close();}
});
test('disabled finite intake, private resumable capabilities, schema snapshot and exactly once conversion survive service recreation',()=>{
 const {db,deps,service,revoked}=fixture();try{
 const form=service.createForm(1,{projectId:'p',title:'Brief',fields:[{id:'email',label:'Email',type:'email',required:true},{id:'note',label:'Notes',type:'text',required:false}]});
 assert.equal(form.payload.enabled,false);assert.throws(()=>service.start(form.payload.token),/недоступна/);
 service.updateForm(1,form.id,1,{enabled:true});const session=service.start(form.payload.token);
 service.updateForm(1,form.id,2,{fields:[{id:'newfield',label:'New question',type:'text',required:true}]});
 assert.equal(session.state.question?.id,'email');assert.throws(()=>service.resume('wrong'),/Сессия/);
 assert.throws(()=>service.answer(session.sessionToken,1,'email','invalid'),/email/);
 assert.throws(()=>service.answer(session.sessionToken,1,'note','skip'),/вопрос/);
 const next=service.answer(session.sessionToken,1,'email','test@example.invalid');assert.equal(next.question?.id,'note');
 const fresh=createTeamService(deps);assert.equal(fresh.resume(session.sessionToken).answers.email,'test@example.invalid');
 assert.throws(()=>fresh.answer(session.sessionToken,1,'email','other@example.invalid'),/изменён/);
 assert.equal(fresh.answer(session.sessionToken,2,'note',null).complete,true);
 const other=fresh.start(form.payload.token);assert.deepEqual(fresh.resume(other.sessionToken).answers,{});assert.equal(fresh.resume(other.sessionToken).question?.id,'newfield');
 const leads=fresh.listLeads(1,form.id);const lead=leads.find((r:any)=>r.payload.next===2);assert.ok(lead);assert.equal('capabilityHash' in lead.payload,false);
 const a=fresh.convertLead(1,lead.id,{assigneeId:2,dueAt:null});const b=fresh.convertLead(1,lead.id,{assigneeId:2,dueAt:null});assert.equal(a.id,b.id);assert.equal(fresh.listAssignments(2,'p').length,1);
 assert.throws(()=>fresh.listLeads(2,form.id),/доступ/);
 revoked.add(1);assert.throws(()=>fresh.resume(session.sessionToken),/недоступна/);
 }finally{db.close();}
});

test('public HTTP strictly limits schema and request size, never exposes staff API or parser stack; staff auth is mandatory',async()=>{
 const {db,deps,service}=fixture();const app=express();app.use('/public',createPublicIntakeRouter(deps));app.use('/team',express.json(),createTeamRouter(deps));
 const form=service.createForm(1,{projectId:'p',title:'Public',fields:[{id:'note',label:'Note',type:'text',required:true}]});service.updateForm(1,form.id,1,{enabled:true});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/team/assignments?projectId=p')).status,401);
  assert.equal((await fetch(base+'/public/assignments')).status,404);
  assert.equal((await post('/public/start',{formToken:form.payload.token,projectId:'private',ownerUserId:2,command:'pwd'})).status,400);
  const start=await post('/public/start',{formToken:form.payload.token});assert.equal(start.status,201);const session=await start.json() as {sessionToken:string;state:Record<string,unknown>};assert.equal('ownerUserId' in session,false);assert.equal('formId' in session.state,false);
  const answer=await post('/public/answer',{sessionToken:session.sessionToken,revision:1,fieldId:'note',value:'<script>alert(1)</script>'});assert.equal(answer.status,200);assert.equal(answer.headers.get('cache-control'),'no-store');
  assert.equal((await post('/public/answer',{sessionToken:session.sessionToken,revision:1,fieldId:'note',value:'repeat'})).status,409);
  assert.equal((await post('/public/start',{formToken:'a'.repeat(14000)})).status,413);
  const malformed=await fetch(base+'/public/start',{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert.equal(malformed.status,400);assert.match(malformed.headers.get('content-type')??'',/application\/json/);assert.equal('stack' in (await malformed.json() as Record<string,unknown>),false);
  for(let i=0;i<11;i++)await post('/public/start',{formToken:form.payload.token});assert.equal((await post('/public/start',{formToken:form.payload.token})).status,429);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();}
});

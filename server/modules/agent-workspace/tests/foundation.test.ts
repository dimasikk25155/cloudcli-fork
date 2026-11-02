import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import express from 'express';

import { WORKSPACE_RECORDS_SCHEMA_SQL } from '../../database/index.js';
import { createWorkspaceStore } from '../store.js';
test('persistent CAS rejects stale updates and rolls back multi-record writes', () => {
 const db = new Database(':memory:');
 db.exec(WORKSPACE_RECORDS_SCHEMA_SQL); db.exec(WORKSPACE_RECORDS_SCHEMA_SQL);
 const store = createWorkspaceStore(db);
 const row = store.create({kind:'task',ownerUserId:1,payload:{title:'A'}});
 assert.equal(createWorkspaceStore(db).get(row.id)?.revision,1);
 assert.equal(store.update(row.id,1,{title:'B'}).revision,2);
 assert.throws(()=>store.update(row.id,1,{title:'lost'}), /изменён/);
 assert.throws(()=>store.transaction(()=>{store.create({id:'rollback',kind:'task',ownerUserId:2,payload:{}});throw new Error('rollback');}));
 assert.equal(store.get('rollback'),undefined);
 assert.equal(store.list('task',{ownerUserId:2}).length,0);
 db.close();
});

import { createDailyService, resolveWorkspaceHandoff } from '../service.js';
import type { WorkspaceDependencies } from '../dependencies.js';
function fixture() {
 const db=new Database(':memory:');db.exec(WORKSPACE_RECORDS_SCHEMA_SQL);let allowed=true;
 const deps:WorkspaceDependencies={store:createWorkspaceStore(db),now:()=>new Date().toISOString(),canAccessProject:()=>allowed,isAdmin:()=>false,getUser:id=>({id,username:'test'}),listUsers:()=>[],getProject:id=>({id,name:'Project',path:'/tmp'}),listProjects:()=>[],handoffs:new Map()};
 return {db,deps,revoke:()=>{allowed=false;}};
}
test('handoff checks access again after asynchronous source resolution',async()=>{
 const {db,deps,revoke}=fixture();deps.handoffs.set('external',async()=>{revoke();return {text:'private',version:'1'};});
 await assert.rejects(resolveWorkspaceHandoff(deps,1,{projectId:'p',source:{kind:'external',id:'x'}}),/доступ/);db.close();
});
test('daily tasks persist across service recreation, enforce ownership, order three active priorities',()=>{
 const {db,deps}=fixture();const service=createDailyService(deps);
 const low=service.create(1,{title:'Third',priority:3,dueAt:'2026-11-02T09:00:00+03:00',completed:false});
 service.create(1,{title:'Second',priority:2,dueAt:null,completed:false});
 service.create(1,{title:'First',priority:1,dueAt:null,completed:false});
 const done=service.create(1,{title:'Done',priority:1,dueAt:null,completed:false});
 service.update(1,done.id,1,{completed:true});
 assert.deepEqual(createDailyService(deps).priorities(1).map(r=>r.payload.title),['First','Second','Third']);
 assert.equal(createDailyService(deps).list(1).find(r=>r.id===low.id)?.payload.dueAt,'2026-11-02T06:00:00.000Z');
 assert.throws(()=>service.update(2,low.id,1,{title:'steal'}),/доступ/);
 assert.throws(()=>service.update(1,done.id,1,{title:'stale'}),/изменён/);
 assert.equal(service.list(2).length,0);db.close();
});

test('file handoff rejects traversal, outside symlink, unsupported bytes and stale versions',async()=>{
 const {db,deps}=fixture();const folder=await mkdtemp(path.join(tmpdir(),'workspace-files-'));const root=path.join(folder,'project');
 const {mkdir}=await import('node:fs/promises');await mkdir(root);await writeFile(path.join(root,'brief.md'),'Selected source');await writeFile(path.join(folder,'private.md'),'private');await symlink(path.join(folder,'private.md'),path.join(root,'escape.md'));await writeFile(path.join(root,'binary.txt'),Buffer.from([0,1,2]));
 deps.getProject=id=>({id,name:'Test',path:root});
 try{
  const good=await resolveWorkspaceHandoff(deps,1,{projectId:'p',source:{kind:'file',id:'brief.md'},instruction:'Review'});
  assert.equal(good.projectPath,root);assert.match(good.text,/Selected source/);assert.ok(good.source.version);
  for(const id of ['../private.md','escape.md','binary.txt'])await assert.rejects(resolveWorkspaceHandoff(deps,1,{projectId:'p',source:{kind:'file',id}}));
  await assert.rejects(resolveWorkspaceHandoff(deps,1,{projectId:'p',source:{kind:'file',id:'brief.md',version:'old'}}),/Версия/);
 }finally{db.close();await rm(folder,{recursive:true,force:true});}
});

import { createWorkspaceRouter } from '../routes.js';
test('HTTP rejects anonymous users and foreign owner updates; client cannot assign ownership',async()=>{
 const {db,deps}=fixture();deps.getUser=id=>[1,2].includes(id)?{id,username:'test'}:null;
 const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,{user:{id:Number(req.headers['x-test-user'])}});next();});app.use(createWorkspaceRouter(deps));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const url='http://127.0.0.1:'+address.port;
 try{
  assert.equal((await fetch(url+'/tasks')).status,401);
  const response=await fetch(url+'/tasks',{method:'POST',headers:{'content-type':'application/json','x-test-user':'1'},body:JSON.stringify({title:'Private',priority:1,dueAt:null,completed:false,ownerUserId:2})});
  assert.equal(response.status,201);const task=await response.json() as {id:string;ownerUserId:number};assert.equal(task.ownerUserId,1);
  assert.deepEqual(await (await fetch(url+'/tasks',{headers:{'x-test-user':'2'}})).json(),[]);
  const update=await fetch(url+'/tasks/'+task.id,{method:'PATCH',headers:{'content-type':'application/json','x-test-user':'2'},body:JSON.stringify({revision:1,completed:true})});assert.equal(update.status,403);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();}
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';

import { createWorkspaceStore, type WorkspaceDependencies } from '../../agent-workspace/index.js';
import { WORKSPACE_RECORDS_SCHEMA_SQL } from '../../database/index.js';
import { createDocumentsService } from '../service.js';
import { createDocumentsRouter } from '../routes.js';
function fixture() {
 const db=new Database(':memory:');db.exec(WORKSPACE_RECORDS_SCHEMA_SQL);const revoked=new Set<number>();
 const deps:WorkspaceDependencies={store:createWorkspaceStore(db),now:()=> '2026-11-02T10:00:00Z',canAccessProject:(user,id)=>id==='p'&&!revoked.has(user),isAdmin:()=>false,getUser:id=>[1,2,3].includes(id)?{id,username:'User '+id}:null,listUsers:()=>[1,2,3].map(id=>({id,username:'User '+id})),getProject:id=>({id,name:id,path:'/tmp'}),listProjects:()=>[],handoffs:new Map()};
 return {db,deps,revoked,service:createDocumentsService(deps)};
}
test('template draft validates required fields and requires explicit owner approval before instantiation',()=>{
 const {db,service}=fixture();
 assert.throws(()=>service.create(1,{projectId:'p',type:'template',title:'',text:'',fields:[]}));
 db.close();
});
test('approved templates produce values literally, enforce fields and ownership, survive service recreation',()=>{
 const {db,deps,service}=fixture();
 const template=service.create(1,{projectId:'p',type:'template',title:'Brief',text:'Recipient: {{name}}',fields:[{key:'name',label:'Name',required:true}]});
 assert.throws(()=>service.instantiate(1,template.id,template.payload.currentVersionId,{name:'A'},'One'),/утвердите/);
 assert.throws(()=>service.approveTemplate(2,template.id,template.revision,template.payload.currentVersionId),/владелец/);
 service.approveTemplate(1,template.id,template.revision,template.payload.currentVersionId);
 assert.throws(()=>service.instantiate(1,template.id,template.payload.currentVersionId,{},'One'),/поле/);
 const document=service.instantiate(2,template.id,template.payload.currentVersionId,{name:'<img src=x onerror=alert(1)>'},'One');
 assert.equal(document.ownerUserId,2);
 assert.equal(createDocumentsService(deps).detail(2,document.id).versions[0].payload.text,'Recipient: <img src=x onerror=alert(1)>');
 db.close();
});
test('immutable versions, stale CAS rollback, comparison and restore preserve content',()=>{
 const {db,service}=fixture();const doc=service.create(1,{projectId:'p',type:'document',title:'A',text:'First paragraph.'});
 const next=service.revise(1,doc.id,doc.revision,{title:'B',text:'Second paragraph.'});
 assert.throws(()=>service.revise(1,doc.id,doc.revision,{title:'Lost',text:'Overwrite'}),/изменён/);
 assert.equal(service.detail(1,doc.id).versions.length,2);
 const comparison=service.compare(1,doc.id,doc.payload.currentVersionId,next.payload.currentVersionId);
 assert.equal(comparison.left.payload.text,'First paragraph.');assert.equal(comparison.right.payload.text,'Second paragraph.');
 const restored=service.restore(1,doc.id,next.revision,doc.payload.currentVersionId);
 assert.notEqual(restored.payload.currentVersionId,doc.payload.currentVersionId);
 assert.equal(service.detail(1,doc.id).versions.find(v=>v.id===restored.payload.currentVersionId)?.payload.text,'First paragraph.');db.close();
});
test('sequential approvals verify actor, exact revision, access revocation and invalidate on edits',()=>{
 const {db,service,revoked}=fixture();const doc=service.create(1,{projectId:'p',type:'document',title:'A',text:'Text'});
 const chain=service.startApproval(1,doc.id,doc.revision,doc.payload.currentVersionId,[2,3]);
 assert.throws(()=>service.approve(3,doc.id,chain.revision,doc.payload.currentVersionId),/другого/);
 assert.throws(()=>service.approve(2,doc.id,chain.revision,'wrong'),/недействительно/);
 revoked.add(2);assert.throws(()=>service.approve(2,doc.id,chain.revision,doc.payload.currentVersionId),/доступ/);revoked.delete(2);
 const first=service.approve(2,doc.id,chain.revision,doc.payload.currentVersionId);
 assert.throws(()=>service.approve(3,doc.id,chain.revision,doc.payload.currentVersionId),/изменён/);
 const last=service.approve(3,doc.id,first.revision,doc.payload.currentVersionId);assert.equal(last.payload.approval?.approved.length,2);
 const edited=service.revise(1,doc.id,last.revision,{title:'A',text:'Changed'});assert.equal(edited.payload.approval,null);
 assert.throws(()=>service.approve(2,doc.id,edited.revision,doc.payload.currentVersionId),/недействительно/);db.close();
});
test('knowledge is opt-in and scoped, handoff binds exact current version and real selected text',()=>{
 const {db,service,revoked}=fixture();const doc=service.create(1,{projectId:'p',type:'document',title:'A',text:'Alpha paragraph.\n\nBeta paragraph.'});
 assert.deepEqual(service.search(2,'p','Alpha'),[]);const enabled=service.knowledge(1,doc.id,doc.revision,true);
 assert.deepEqual(service.search(2,'p','Alpha').map(h=>[h.title,h.versionId]),[['A',doc.payload.currentVersionId]]);
 assert.equal(service.handoff(2,'p',doc.id,doc.payload.currentVersionId,'Beta paragraph.').text,'Beta paragraph.');
 assert.throws(()=>service.handoff(2,'p',doc.id,doc.payload.currentVersionId,'Forged paragraph'),/Фрагмент/);
 service.revise(1,doc.id,enabled.revision,{title:'B',text:'Beta'});
 assert.throws(()=>service.handoff(2,'p',doc.id,doc.payload.currentVersionId,'Beta paragraph.'),/Версия/);
 revoked.add(2);assert.throws(()=>service.search(2,'p','Beta'),/доступ/);assert.throws(()=>service.detail(2,doc.id),/доступ/);db.close();
});

test('HTTP routes use authenticated actor, reject stale edits and unknown project access',async()=>{
 const {db,deps}=fixture();const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,{user:{id:Number(req.headers['x-test-user'])}});next();});app.use(createDocumentsRouter(deps));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const call=(path:string,body?:unknown,user=1)=>fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-test-user':String(user)},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await fetch(base+'/?projectId=p')).status,401);
  assert.equal((await call('/?projectId=other')).status,403);
  const response=await call('/',{projectId:'p',type:'document',title:'HTTP',text:'Body',ownerUserId:3});assert.equal(response.status,201);const row=await response.json() as {id:string;revision:number;ownerUserId:number};assert.equal(row.ownerUserId,1);
  assert.equal((await call('/'+row.id+'/revisions',{revision:row.revision,title:'Changed',text:'New'},2)).status,403);
  assert.equal((await call('/'+row.id+'/revisions',{revision:row.revision,title:'Changed',text:'New'})).status,200);
  assert.equal((await call('/'+row.id+'/revisions',{revision:row.revision,title:'Lost',text:'New'})).status,409);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();}
});

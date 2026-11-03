import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeDatabase,closeConnection,projectsDb,sessionsDb,userDb,userProjectAccessDb } from '../../database/index.js';
import { createThreadRunControl,chatRunRegistry } from '../../websocket/index.js';
import { threadTokens } from '../../threads/index.js';
import { workspaceDependencies } from '../runtime.js';
import { bindWorkspaceHandoff,resolveWorkspaceHandoff,createDailyService } from '../service.js';

test('actual run token gate: threads off without grant has no token; bound current actor/project grant supplies workspace token',async()=>{
 await initializeDatabase();
 try {
  const admin=Number(userDb.createUserWithRole('workspace-admin','unused','admin').id);
  const owner=Number(userDb.createUserWithRole('workspace-owner','unused','user').id);
  const project=projectsDb.createProjectPath('/workspace/granted-project').project!;
  userProjectAccessDb.grantAccess(owner,project.project_id,admin);
  for (const id of ['without-grant','with-grant']) sessionsDb.createAppSession(id,'grok',project.project_path);
  const spawns:Array<Record<string,unknown>>=[];
  const control=createThreadRunControl({
   userJailFor:()=>null,
   spawnFns:{grok:async(_command:string,options:Record<string,unknown>)=>{spawns.push(options);await new Promise(()=>{});}},
   abortFns:{},resolveToolApproval:()=>{},getPendingApprovalsForSession:()=>[],isModOn:(_user:unknown,key:string)=>key!=='modThreads',
  } as unknown as Parameters<typeof createThreadRunControl>[0]);
  control.start({sessionId:'without-grant',userId:owner,parentSessionId:'without-grant',content:'Test',options:{}});
  assert.deepEqual(spawns[0].threadsEnv,{NEO3_THREADS_OFF:'1'});
  const task=createDailyService(workspaceDependencies).create(owner,{title:'Brief',dueAt:null,priority:1,completed:false});
  const handoff=await resolveWorkspaceHandoff(workspaceDependencies,owner,{projectId:project.project_id,source:{kind:'daily-task',id:task.id}});
  bindWorkspaceHandoff(workspaceDependencies,owner,handoff.grantId,'with-grant');
  control.start({sessionId:'with-grant',userId:owner,parentSessionId:'with-grant',content:'Test',options:{}});
  const env=spawns[1].threadsEnv as Record<string,string>;
  assert.equal(env.NEO3_THREADS_OFF,'1');
  assert.deepEqual(threadTokens.resolve(env.NEO3_THREADS_TOKEN),{sessionId:'with-grant',userId:owner,permissionMode:null});
 } finally {chatRunRegistry.clearAll();closeConnection();}
});

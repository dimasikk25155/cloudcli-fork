import test from 'node:test';
import assert from 'node:assert/strict';

import { stageWorkspaceHandoff, selectHandoffProject, HANDOFF_STORAGE_PREFIX, bindPendingWorkspaceHandoffs, cancelPendingWorkspaceHandoffs } from './handoff';
test('handoff opens selected project via normal new-chat callback and preserves existing draft and model choices', () => {
    const values = new Map([['draft_input_b', 'User draft'], ['selected-provider', 'codex'], ['codex-model', 'gpt-6-astra'], ['effort', 'high']]);
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
    stageWorkspaceHandoff({ projectId: 'b', projectPath: '/b', source: { kind: 'document', id: 'doc' }, text: 'Material', grantId: 'grant' }, storage, storage);
    let selected = 'a', navigated = false;
    selectHandoffProject([{ projectId: 'a' }, { projectId: 'b' }], 'b', project => { selected = project.projectId; navigated = true; });
    assert.equal(selected, 'b');
    assert.equal(navigated, true);
    assert.equal(values.get('draft_input_b'), 'User draft\n\nMaterial');
    assert.equal(values.get('selected-provider'), 'codex');
    assert.equal(values.get('codex-model'), 'gpt-6-astra');
    assert.equal(values.get('effort'), 'high');
    assert.match(values.get(HANDOFF_STORAGE_PREFIX + 'b')!, /grant/);
    assert.throws(() => selectHandoffProject([{ projectId: 'a' }], 'b', () => assert.fail('must not navigate')));
});

test('staging two materials preserves both server grants for the combined draft', () => {
 const values = new Map<string,string>();
 const storage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 for (const id of ['a','b']) stageWorkspaceHandoff({projectId:'p',projectPath:'/p',source:{kind:'mail-message',id},text:'Letter '+id,grantId:'grant-'+id},storage,storage);
 assert.deepEqual(JSON.parse(values.get(HANDOFF_STORAGE_PREFIX+'p')!).map((item:any)=>item.grantId),['grant-a','grant-b']);
 assert.equal(values.get('draft_input_p'),'Letter a\n\nLetter b');
});

test('all staged materials bind once and a failed grant can be explicitly cancelled without losing the draft', async () => {
 const values = new Map<string,string>([['draft_input_p','My question']]);
 const storage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 for(const id of ['a','expired']) stageWorkspaceHandoff({projectId:'p',projectPath:'/p',source:{kind:'mail-message',id},text:'Letter '+id,grantId:id},storage,storage);
 const calls:string[]=[];
 const bind=async(id:string,sessionId:string)=>{assert.equal(sessionId,'session');calls.push(id);if(id==='expired')throw new Error('Передача истекла');};
 await assert.rejects(bindPendingWorkspaceHandoffs('p','session',storage,bind),/истекла/);
 assert.deepEqual(calls,['a','expired']);
 const draft=values.get('draft_input_p');
 await assert.rejects(bindPendingWorkspaceHandoffs('p','session',storage,bind),/истекла/);
 assert.deepEqual(calls,['a','expired','expired']);
 cancelPendingWorkspaceHandoffs('p',storage);
 assert.equal(values.get('draft_input_p'),draft);
 await bindPendingWorkspaceHandoffs('p','session',storage,()=>assert.fail('ordinary send must not bind cancelled grants'));
 for(const id of ['b','c'])stageWorkspaceHandoff({projectId:'p',projectPath:'/p',source:{kind:'mail-message',id},text:'Letter '+id,grantId:id},storage,storage);
 await bindPendingWorkspaceHandoffs('p','session',storage,async id=>{calls.push(id);});
 assert.deepEqual(calls.slice(-2),['b','c']);
 assert.equal(values.has(HANDOFF_STORAGE_PREFIX+'p'),false);
});

test('invalid pending data is cancellable and old single-material drafts remain bindable',async()=>{
 const values=new Map([[HANDOFF_STORAGE_PREFIX+'p','{']]);
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 await assert.rejects(bindPendingWorkspaceHandoffs('p','s',storage,async()=>assert.fail('invalid grant')));
 cancelPendingWorkspaceHandoffs('p',storage);
 await bindPendingWorkspaceHandoffs('p','s',storage,async()=>assert.fail('cancelled grant'));
 storage.setItem(HANDOFF_STORAGE_PREFIX+'p',JSON.stringify({projectId:'p',grantId:'old'}));
 const calls:string[]=[];await bindPendingWorkspaceHandoffs('p','s',storage,async id=>{calls.push(id);});assert.deepEqual(calls,['old']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRelease, activityBlockers } from './apply-combined-local-release.mjs';

const fixture = (overrides = {}) => {
  const log = [];
  const effects = Object.fromEntries(['preflight', 'backup', 'swap', 'restore', 'restart', 'verify'].map(name => [name, async (...args) => { log.push([name, ...args]); }]));
  effects.save = async state => log.push(['save', structuredClone(state)]);
  return { log, effects: { ...effects, ...overrides } };
};
test('applies once, persists intent before restart, then verifies', async () => {
  const {log,effects}=fixture();
  const result=await executeRelease(effects);
  assert.equal(result.status,'verified');
  assert.deepEqual(log.filter(x=>x[0]!=='save').map(x=>x[0]),['preflight','backup','preflight','swap','preflight','restart','verify']);
  const i=log.findIndex(x=>x[0]==='restart');
  assert.equal(log[i-1][0],'save');
  assert.equal(log[i-1][1].restartIssued,true);
});
test('failed preflight never backs up, swaps or restarts',async()=>{
  const {log,effects}=fixture({preflight:async()=>{throw new Error('other activity');}});
  assert.equal((await executeRelease(effects)).status,'failed');
  assert.deepEqual(log.filter(x=>x[0]!=='save'),[]);
});
test('a partial swap failure restores without restarting',async()=>{
  const {log,effects}=fixture({swap:async()=>{throw new Error('swap failed');}});
  const result=await executeRelease(effects);
  assert.equal(result.status,'failed');
  assert.equal(result.rollback.status,'restored-before-restart');
  assert.equal(log.filter(x=>x[0]==='restart').length,0);
  assert.equal(log.filter(x=>x[0]==='restore').length,1);
});
test('failed verification restores builds and issues exactly one recovery restart',async()=>{
  const {log,effects}=fixture({verify:async rollback=>{if(!rollback)throw new Error('bad public bundle');}});
  const result=await executeRelease(effects);
  assert.equal(result.status,'failed');
  assert.equal(result.rollback.status,'verified');
  assert.equal(result.recoveryRestartIssued,true);
  assert.deepEqual(log.filter(x=>x[0]==='restart').map(x=>x[1]),[false,true]);
});
test('rollback verification failure is recorded and never retried',async()=>{
  const {log,effects}=fixture({verify:async()=>{throw new Error('unavailable');}});
  const result=await executeRelease(effects);
  assert.equal(result.status,'failed');
  assert.equal(result.rollback.status,'failed');
  assert.equal(log.filter(x=>x[0]==='restart').length,2);
});
test('only the exact controller PID and working session may remain active',()=>{
  const table='10 1 node\n20 10 /bin/codex.neo3-direct exec\n21 10 node /plugins/test/server.js\n30 1 node executor';
  const controller={pid:20,sessionId:'own'};
  assert.deepEqual(activityBlockers(table,10,controller,[{session_id:'own'}],30),[]);
  assert.ok(activityBlockers(table+'\n22 10 grok',10,controller,[{session_id:'own'}],30).some(x=>x==='runtime-children'));
  assert.ok(activityBlockers(table,10,controller,[{session_id:'other'}],30).includes('working-sessions'));
  assert.ok(activityBlockers(table.replace('/bin/codex.neo3-direct exec','unknown'),10,controller,[],30).includes('controller-identity'));
  assert.deepEqual(activityBlockers('10 1 node\n30 1 node executor',10,controller,[],30),[]);
  assert.ok(activityBlockers('10 1 node\n30 1 node executor',10,controller,[{session_id:'own'}],30).includes('working-sessions'));
});
test('a separate release process is refused, regardless of its parent',()=>{
  const table='10 1 node\n30 1 node /scripts/apply-combined-local-release.mjs --apply manifest\n40 1 /usr/local/bin/node /maintenance/coordinated-release-20261103/watcher.mjs --watch manifest';
  assert.ok(activityBlockers(table,10,null,[],30).includes('other-release'));
});
test('status write failure after swap still restores the old build',async()=>{
  const {log,effects}=fixture();
  effects.save=async state=>{if(state.status==='restarting'||state.status==='failed')throw new Error('disk unavailable');};
  const result=await executeRelease(effects);
  assert.equal(result.status,'failed');
  assert.ok(log.some(x=>x[0]==='restore'));
  assert.equal(log.filter(x=>x[0]==='restart').length,0);
});

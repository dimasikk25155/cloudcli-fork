// Run against the already-running shared Edge; never launch another browser.
// node scripts/test-voice-recovery-browser.mjs [http://127.0.0.1:19224]
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';

const cdp = process.argv[2] || 'http://127.0.0.1:19224';
const version = await (await fetch(`${cdp}/json/version`)).json();
if (!version.Browser?.includes('Edg/')) throw new Error('Use the shared Microsoft Edge instance');
const bundle = await build({ entryPoints: ['scripts/voice-recovery.fixture.tsx'], bundle: true,
  write: false, format: 'esm', platform: 'browser', define: { 'import.meta.env': '{}' } });
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('content-type', 'text/javascript');
    response.end(bundle.outputFiles[0].text);
  } else {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const socket = new WebSocket(version.webSocketDebuggerUrl);
await once(socket, 'open');
const requests = new Map();
let sequence = 0;
let targetId;
let sessionId;
socket.on('message', (data) => {
  const message = JSON.parse(data.toString());
  const pending = requests.get(message.id);
  if (pending) {
    requests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }
});
function call(method, params = {}, session) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    requests.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
const ready = `new Promise((resolve,reject)=>{const end=Date.now()+10000;const poll=()=>window.voiceRecoveryChecks?resolve(true):Date.now()>end?reject(new Error('Fixture did not load')):setTimeout(poll,25);poll();})`;
try {
  ({ targetId } = await call('Target.createTarget', { url: `http://127.0.0.1:${server.address().port}` }));
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }));
  await evaluate(ready);
  const first = await evaluate('window.voiceRecoveryChecks.firstPass()');
  await call('Page.reload', {}, sessionId);
  // Wait for the new execution context instead of racing a reload's navigation.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await evaluate(ready);
  const second = await evaluate('window.voiceRecoveryChecks.afterReload()');
  const third = await evaluate('window.voiceRecoveryChecks.readyResult()');
  const fourth = await evaluate('window.voiceRecoveryChecks.storageFailure()');
  console.log(JSON.stringify({ passed: [...first.passed, ...second.passed, ...third.passed, ...fourth.passed] }, null, 2));
} finally {
  if (targetId) await call('Target.closeTarget', { targetId }).catch(() => {});
  socket.close();
  server.closeAllConnections();
  server.close();
}

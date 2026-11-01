/** Explicit, bounded live QA. Uses the local owner's auth only in memory. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function verifyCodexProduction(origin = 'https://claude.neo3.ru') {
  await import(pathToFileURL(path.join(ROOT, 'dist-server/server/load-env.js')).href);
  const { generateToken } = await import(pathToFileURL(path.join(ROOT, 'dist-server/server/middleware/auth.js')).href);
  const { userDb, sessionsDb } = await import(pathToFileURL(path.join(ROOT, 'dist-server/server/modules/database/index.js')).href);
  const user = userDb.getFirstUser();
  assert.equal(user?.role, 'admin');
  const token = generateToken(user);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(`${origin}${route}`, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    assert.equal(response.ok, true, `HTTP ${response.status}: ${route}`);
    return response.json();
  };
  const limits = await api('/api/usage/limits?provider=codex');
  assert.ok('codex' in limits && !('fiveHourPct' in limits), 'Codex must not receive Claude limits');
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'neo3-production-qa-'));
  const created = await api('/api/providers/sessions', 'POST', { provider: 'codex', projectPath: cwd });
  const sessionId = created.data.sessionId;
  const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/ws`, { headers, handshakeTimeout: 20000 });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const exchange = (payload, stop, timeout = 180000) => new Promise((resolve, reject) => {
    const frames = [];
    const finish = (error) => { clearTimeout(timer); socket.off('message', receive); error ? reject(error) : resolve(frames); };
    const timer = setTimeout(() => finish(new Error('Live QA timed out')), timeout);
    const receive = (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.sessionId !== sessionId) return;
      frames.push(frame);
      if (frame.kind === 'error' || frame.kind === 'protocol_error') finish(new Error(`QA frame: ${frame.kind}`));
      else if (stop(frame)) finish();
    };
    socket.on('message', receive);
    socket.send(JSON.stringify(payload));
  });
  const turns = [];
  const turn = async (content, effort) => {
    const frames = await exchange({ type: 'chat.send', sessionId, content,
      options: { model: 'gpt-6.1-sol', effort, permissionMode: 'bypassPermissions', cwd } }, f => f.kind === 'complete');
    assert.equal(frames.at(-1).exitCode, 0);
    const ack = await exchange({ type: 'chat.subscribe', sessions: [{ sessionId, lastSeq: 0 }] }, f => f.kind === 'chat_subscribed', 10000);
    assert.equal(ack.at(-1).isProcessing, false, 'Question/answer must release the composer');
    turns.push({ effort, kinds: frames.map(f => f.kind), idle: true });
    return frames;
  };
  let completed = false;
  try {
    const question = await turn('Это одноразовый технический QA Neo3. Не читай файлы и не записывай память. Спроси меня, какой цвет выбрать: синий или зелёный. Не выбирай сам. Заверши ход сразу после вопроса.', 'low');
    assert.ok(question.some(f => f.kind === 'text' && f.content?.includes('?')));
    const answer = await turn('Выбираю зелёный. Ответь NEO3_PROD_GREEN_OK. Никаких вопросов, инструментов и записей памяти.', 'high');
    assert.ok(answer.some(f => f.kind === 'text' && f.content?.includes('NEO3_PROD_GREEN_OK')));
    const tool = await turn('Последний технический тест: выполни одну команду printf NEO3_PROD_TOOL_OK, затем ответь NEO3_PROD_DONE. Не задавай вопросов, не читай другие файлы и не записывай память.', 'low');
    assert.ok(tool.some(f => f.kind === 'tool_result'));
    assert.ok(tool.some(f => f.kind === 'text' && f.content?.includes('NEO3_PROD_DONE')));
    const nativeId = sessionsDb.getSessionById(sessionId)?.provider_session_id;
    assert.ok(nativeId);
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) { const hit = await walk(filename); if (hit) return hit; }
        else if (entry.name.includes(nativeId) && entry.name.endsWith('.jsonl')) return filename;
      }
      return null;
    };
    const filename = await walk(path.join(home, 'sessions'));
    assert.ok(filename, 'Native rollout must exist');
    const contexts = (await readFile(filename, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      .filter(row => row.type === 'turn_context').map(row => ({ model: row.payload.model, effort: row.payload.effort }));
    assert.deepEqual(contexts.map(c => c.effort), ['low', 'high', 'low']);
    completed = true;
    return { verified: true, origin, sessionId, nativeId, turns, contexts,
      limitsAvailable: Boolean(limits.codex?.windows?.length), checkedAt: new Date().toISOString() };
  } finally {
    if (!completed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'chat.abort', sessionId }));
    socket.close();
    // Keep evidence restorable, but do not clutter the owner's active chats.
    await api(`/api/providers/sessions/${sessionId}`, 'DELETE');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--run') throw new Error('Explicit --run required: this starts three model turns');
  const result = await verifyCodexProduction(process.env.NEO3_QA_ORIGIN || undefined);
  if (process.env.NEO3_QA_REPORT) await writeFile(process.env.NEO3_QA_REPORT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

/** Explicit production smoke: real model turns in disposable local repositories. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
await import('../dist-server/server/load-env.js');
const { generateToken } = await import('../dist-server/server/middleware/auth.js');
const { userDb, sessionsDb, projectsDb } = await import('../dist-server/server/modules/database/index.js');
if (process.argv[2] !== '--run') throw Error('Explicit --run required: three live model turns');
const reportFile = '/tmp/neo3-work-modes-qa.json';
const report = { status: 'running', cases: [] };
const save = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2));
const origin = 'https://claude.neo3.ru';
const headers = { Authorization: `Bearer ${generateToken(userDb.getFirstUser())}`, 'Content-Type': 'application/json' };
async function api(route, method = 'GET', body) {
 const r = await fetch(origin + route, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(20000) });
 assert.ok(r.ok, `${route}: ${r.status}`); return r.json();
}
async function runCase(name, permissionMode, workMode, prompt, verify, timeout = 180000) {
 const cwd = await fs.mkdtemp(path.join(os.tmpdir(), `neo3-${name}-`));
 execFileSync('git', ['init', '-q'], { cwd });
 await fs.writeFile(path.join(cwd, '.gitignore'), '.env\n.env.*\nnode_modules/\n.autopilot/serve.*\n');
 const id = (await api('/api/providers/sessions', 'POST', { provider: 'codex', projectPath: cwd })).data.sessionId;
 const item = { name, permissionMode, workMode, cwd, sessionId: id, status: 'running', text: [], kinds: [], tools: [] };
 report.cases.push(item); await save();
 const socket = new WebSocket('wss://claude.neo3.ru/ws', { headers });
 await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
 try {
  await new Promise((resolve, reject) => {
   const timer = setTimeout(() => reject(Error(`${name}: timeout`)), timeout);
   socket.on('message', raw => {
    const f = JSON.parse(String(raw)); if (f.sessionId !== id) return;
    item.kinds.push(f.kind);
    if (f.kind === 'text') item.text.push(f.content);
    if (f.kind === 'tool_use') item.tools.push(f.toolName);
    if (f.kind === 'text' || f.kind === 'tool_result') void save();
    if (f.kind === 'error' || f.kind === 'protocol_error') { clearTimeout(timer); reject(Error(`${name}: ${f.kind}`)); }
    if (f.kind === 'complete') { clearTimeout(timer); f.exitCode === 0 ? resolve() : reject(Error(`${name}: exit ${f.exitCode}`)); }
   });
   socket.send(JSON.stringify({ type: 'chat.send', sessionId: id, content: prompt + '\nЭто одноразовая локальная проверка. Не публикуй, не создавай GitHub-репозиторий, не открывай браузер и не пиши в Obsidian. Работай только в текущей тестовой папке. Все требования заданы, вопросов не требуется.',
    options: { cwd, model: 'gpt-6-astra', effort: 'medium', permissionMode, workMode } }));
  });
  item.nativeId = sessionsDb.getSessionById(id)?.provider_session_id;
  await verify(cwd, item);
  item.status = 'passed'; await save();
 } finally {
  if (item.status !== 'passed') socket.send(JSON.stringify({ type: 'chat.abort', sessionId: id }));
  socket.close(); await api(`/api/providers/sessions/${id}`, 'DELETE');
  projectsDb.updateProjectIsArchived(cwd, true);
 }
}
try {
 await runCase('plan', 'plan', 'autopilot', 'Создай файл ready.txt с текстом PLAN_OK.', async cwd => {
  await assert.rejects(fs.access(path.join(cwd, 'ready.txt')));
 });
 await runCase('plan-bypass', 'planBypass', 'autopilot', 'Создай файл ready.txt с точным текстом PLAN_BYPASS_OK. Проверь содержимое.', async (cwd, item) => {
  assert.equal((await fs.readFile(path.join(cwd, 'ready.txt'), 'utf8')).trim(), 'PLAN_BYPASS_OK');
  assert.ok(item.kinds.indexOf('text') < item.kinds.indexOf('tool_use'));
 });
 await runCase('autopilot-v2', 'planBypass', 'build', 'Собери через установленный Autopilot v2 небольшой законченный проект, strict: консольный конвертер температуры на Node.js без зависимостей. Файл convert.mjs экспортирует cToF(c) и fToC(f), отклоняет NaN и Infinity с TypeError. cli.mjs принимает направление c-to-f либо f-to-c и число, выводит только результат, при неверных аргументах ненулевой код. Нужны node:test-тесты convert.test.mjs и README с командами. Проведи требования, спецификацию, план, разработку, проверку и приёмку, сохрани настоящий .autopilot/state.js и manifest.md. Это одноразовый T1-тест; не разворачивай сервер дашборда, достаточно файлов. После создания плана продолжай до готового результата без дополнительного согласования.', async (cwd, item) => {
  const mod = await import(path.join(cwd, 'convert.mjs'));
  assert.equal(mod.cToF(0), 32); assert.equal(mod.fToC(212), 100);
  assert.throws(() => mod.cToF(NaN), TypeError); assert.throws(() => mod.fToC(Infinity), TypeError);
  assert.equal(execFileSync(process.execPath, ['cli.mjs', 'c-to-f', '100'], { cwd, encoding: 'utf8' }).trim(), '212');
  execFileSync(process.execPath, ['--test', 'convert.test.mjs'], { cwd });
  const state = await fs.readFile(path.join(cwd, '.autopilot/state.js'), 'utf8');
  const parsed = JSON.parse(state.replace(/^window\.STATE\s*=\s*/, '').replace(/;\s*$/, ''));
  assert.ok(parsed.finishedAt, 'Autopilot must finish, not only create state.js');
  assert.equal(parsed.version, 2);
  assert.ok(parsed.requirements.total > 0);
  assert.equal(parsed.requirements.done, parsed.requirements.total);
  assert.ok(parsed.tickets.length > 0);
  assert.ok(parsed.tickets.every(t => t.status === 'done'));
  await fs.access(path.join(cwd, '.autopilot', parsed.dir, 'manifest.md'));
  item.state = parsed;
 }, 720000);
 report.status = 'passed'; await save(); process.exit(0);
} catch (e) { report.status = 'failed'; report.error = String(e?.message || e); await save(); console.error(report.error); process.exit(1); }

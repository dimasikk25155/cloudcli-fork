/** Opt-in live adapter QA. All chats, files, MCP and database writes use a disposable HOME. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import sharp from 'sharp';

if (process.argv[2] !== '--run') throw new Error('Explicit --run required: this uses live Codex model turns');
const authHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const reportFile = process.env.NEO3_CODEX_QA_REPORT || '/tmp/neo3-codex-compat-qa.json';
const model = process.env.NEO3_CODEX_QA_MODEL || 'gpt-6.1-sol';
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neo3-codex-compat-')));
const home = path.join(root, 'home');
const project = path.join(root, 'workspace');
const report = { status: 'running', model, cases: [], startedAt: new Date().toISOString() };
const save = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2));
await fs.mkdir(path.join(home, '.codex'), { recursive: true, mode: 0o700 });
await fs.mkdir(project);
process.env.HOME = home;
process.env.CODEX_HOME = path.join(home, '.codex');
process.env.DATABASE_PATH = path.join(home, 'auth.db');
process.env.NEO3_THREADS_MCP = 'off';
process.env.NEO3_DUET_WATCH = 'off';
process.env.NEO3_MEMORY_SUGGESTIONS = 'off';
process.env.NEO3_KRABIK_WATCH = 'off';
delete process.env.NEO3_THREADS_TOKEN;
delete process.env.NEO3_THREADS_API_URL;
await fs.writeFile(process.env.DATABASE_PATH, '');
let closeDatabase = () => {};
let abortAll = () => {};
try {
  await fs.access(path.join(authHome, 'auth.json'));
  await fs.symlink(path.join(authHome, 'auth.json'), path.join(process.env.CODEX_HOME, 'auth.json'));
  await fs.copyFile(path.join(authHome, 'models_cache.json'), path.join(process.env.CODEX_HOME, 'models_cache.json')).catch(() => {});
  const mcpFile = path.join(root, 'fixture-mcp.mjs');
  const mcpCalls = path.join(root, 'mcp-calls.jsonl');
  await fs.writeFile(mcpFile, `import readline from 'node:readline';
import fs from 'node:fs';
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
 const req = JSON.parse(line); if (req.id == null) return;
 let result;
 if (req.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
 else if (req.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Return the supplied fixture value', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }, annotations: { readOnlyHint: true, destructiveHint: false } }] };
 else if (req.method === 'tools/call') { fs.appendFileSync(${JSON.stringify(mcpCalls)}, JSON.stringify(req.params) + '\\n'); result = { content: [{ type: 'text', text: req.params.arguments.value }] }; }
 else result = {};
 process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\\n');
});`);
  await fs.writeFile(path.join(process.env.CODEX_HOME, 'config.toml'), `model = ${JSON.stringify(model)}
web_search = "disabled"
[features]
apps = false
plugins = false
hooks = false
multi_agent = false
multi_agent_v2 = false
[mcp_servers.fixture]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(mcpFile)}]
tool_timeout_sec = 10
[mcp_servers.fixture.tools.echo]
approval_mode = "approve"
`);
  await fs.writeFile(path.join(project, 'AGENTS.md'), 'This is a disposable compatibility fixture. Only work in this directory. Do not delegate, use other services, write memory or publish anything.');
  const nonce = randomUUID();
  await fs.writeFile(path.join(project, 'input.txt'), nonce);
  const [color, background] = [['RED', '#ff0000'], ['GREEN', '#00ff00'], ['BLUE', '#0000ff']][randomInt(3)];
  await sharp({ create: { width: 64, height: 64, channels: 3, background } }).png().toFile(path.join(project, 'attachment.png'));
  const db = await import('../server/modules/database/index.ts');
  closeDatabase = db.closeConnection;
  await db.initializeDatabase();
  const { queryCodex, isCodexSessionActive, getActiveCodexSessions, abortCodexSession } = await import('../server/openai-codex.js');
  abortAll = () => { for (const run of getActiveCodexSessions()) abortCodexSession(run.id); };
  const { CodexProviderAuth } = await import('../server/modules/providers/list/codex/codex-auth.provider.ts');
  const { getCodexUsage } = await import('../server/modules/providers/list/codex/codex-limits.ts');
  const account = await new CodexProviderAuth().getStatus();
  assert.equal(account.installed, true);
  assert.equal(account.authenticated, true);
  report.auth = { installed: account.installed, authenticated: account.authenticated, method: account.method };
  report.limitsAvailable = Boolean((await getCodexUsage())?.windows.length);
  let sessionId;
  async function turn(name, prompt, options = {}) {
    const rows = [];
    const activeAtCompletion = [];
    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); abortAll(); }, 120000);
    const item = { name, status: 'running' };
    report.cases.push(item); await save();
    try {
      await queryCodex(prompt, { cwd: project, model, effort: 'low', permissionMode: 'bypassPermissions', sessionId, ...options, signal: controller.signal }, {
        isWebSocketWriter: true,
        send(row) {
          rows.push(row);
          if (row.kind === 'session_created') sessionId = row.sessionId;
          if (row.kind === 'complete') activeAtCompletion.push(isCodexSessionActive(row.sessionId));
        },
      });
      assert.equal(timedOut, false, `${name} timed out`);
      assert.equal(rows.filter(row => row.kind === 'complete').length, 1);
      assert.deepEqual(activeAtCompletion, [false], 'completion must release the run');
      const errors = rows.filter(row => row.kind === 'error');
      assert.equal(errors.length, 0, `${name}: ${errors.map(row => row.content).join('; ')}`);
      assert.equal(rows.find(row => row.kind === 'complete').exitCode, 0);
      item.kinds = [...new Set(rows.map(row => row.kind))];
      item.tools = [...new Set(rows.filter(row => row.kind === 'tool_use').map(row => row.toolName))];
      item.status = 'passed';
      await save();
      return rows;
    } finally { clearTimeout(timer); }
  }
  let rows = await turn('file-command-mcp-image', 'Compatibility test: read input.txt, call fixture MCP echo with its exact contents, and use apply_patch to add ready.txt with those same contents. Inspect the attached image and identify its solid color. Do not read the image file through commands. Run one shell command to verify ready.txt. End with NEO3_COMPAT_COLOR_<UPPERCASE_COLOR_NAME> and NEO3_COMPAT_WRITE_OK. Use only this workspace; do not ask questions.', { images: [{ path: path.join(project, 'attachment.png') }] });
  assert.equal((await fs.readFile(path.join(project, 'ready.txt'), 'utf8')).trim(), nonce);
  assert.ok((await fs.readFile(mcpCalls, 'utf8')).includes(nonce), 'fixture MCP must really execute');
  assert.ok(rows.some(row => row.kind === 'tool_result'));
  assert.ok(rows.some(row => row.kind === 'tool_use' && row.toolName === 'FileChanges'), 'native file-change event must reach Neo3');
  assert.ok(rows.some(row => row.kind === 'text' && row.content.includes(`NEO3_COMPAT_COLOR_${color}`)), 'image color must be recognized without an answer in the prompt');
  report.imageColor = color;
  await turn('resume-plan-readonly', 'Plan-only test: explain a numbered plan for creating forbidden.txt. Do not create it. All requirements are known; no questions.', { permissionMode: 'plan', effort: 'high' });
  await assert.rejects(fs.access(path.join(project, 'forbidden.txt')));
  rows = await turn('question-yields', 'Ask me which color to choose, blue or green. Do not choose yourself. Ask in your final answer and immediately end the turn. Do not use tools.');
  assert.ok(rows.some(row => row.kind === 'text' && row.content.includes('?')));
  rows = await turn('answer-and-accept-edits', 'I choose green. Write GREEN to color.txt using a shell command, then reply NEO3_COMPAT_GREEN_OK. No questions.', { permissionMode: 'acceptEdits' });
  assert.equal((await fs.readFile(path.join(project, 'color.txt'), 'utf8')).trim(), 'GREEN');
  assert.ok(rows.some(row => row.kind === 'text' && row.content.includes('NEO3_COMPAT_GREEN_OK')));
  rows = await turn('default-trusted-command', 'Run the trusted command pwd, then reply NEO3_COMPAT_DEFAULT_OK. No file changes or questions.', { permissionMode: 'default' });
  assert.ok(rows.some(row => row.kind === 'tool_result' && !row.isError));
  const walk = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) { const hit = await walk(filename); if (hit) return hit; }
      else if (entry.name.includes(sessionId) && entry.name.endsWith('.jsonl')) return filename;
    }
    return null;
  };
  const transcript = await walk(path.join(process.env.CODEX_HOME, 'sessions'));
  assert.ok(transcript);
  const entries = (await fs.readFile(transcript, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  report.contexts = entries.filter(row => row.type === 'turn_context').map(row => ({ model: row.payload.model, effort: row.payload.effort, sandbox: row.payload.sandbox_policy?.type }));
  assert.deepEqual(report.contexts.map(row => row.effort), ['low', 'high', 'low', 'low', 'low']);
  assert.equal(report.contexts[1].sandbox, 'read-only');
  const appId = db.sessionsDb.createSession(sessionId, 'codex', project, 'Fixture', undefined, undefined, transcript);
  const { CodexSessionsProvider } = await import('../server/modules/providers/list/codex/codex-sessions.provider.ts');
  const historyProvider = new CodexSessionsProvider();
  const history = await historyProvider.fetchHistory(appId);
  assert.equal(history.messages.filter(row => row.role === 'user').length, 5);
  assert.deepEqual((await historyProvider.fetchHistory(appId)).messages.map(row => row.id), history.messages.map(row => row.id));
  assert.ok(history.messages.some(row => row.images?.length));
  report.history = { userTurns: 5, stableIds: true, images: true };
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error.message || error);
  process.exitCode = 1;
} finally {
  abortAll(); closeDatabase();
  report.finishedAt = new Date().toISOString();
  await save();
  await fs.rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}

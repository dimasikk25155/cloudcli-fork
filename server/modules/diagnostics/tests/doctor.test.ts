import assert from 'node:assert/strict';
import test from 'node:test';

import { createDoctor } from '@/modules/diagnostics/doctor.js';
import type { DiagExec, DiagFs } from '@/modules/diagnostics/diagnostics.types.js';

const SECRET = 'sk-live-SECRET-VALUE-123';

function memoryFs(files: Record<string, string>): DiagFs {
  return {
    readFile: async (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    readdir: async () => [],
    isDirectory: async () => false,
    exists: async (p) => p in files,
    realpath: async (p) => p,
    fileSize: async (p) => (p === '/h/.cloudcli/auth.db' ? 5 * 1024 * 1024 : null),
  };
}

const goodExec: DiagExec = async (command, args) => {
  if (command === 'claude' || command === 'codex') return { code: 0, stdout: `${command} 2.1.5 (tool)\n`, stderr: '' };
  if (command === 'grok') return { code: 127, stdout: '', stderr: '' };
  if (command === 'security') return { code: 0, stdout: `password: "${SECRET}"`, stderr: '' };
  if (command === 'curl') return { code: 0, stdout: '200', stderr: '' };
  if (command === 'df') return { code: 0, stdout: 'Filesystem 1K-blocks Used Available Capacity\n/dev/x 100 50 52428800 50% /\n', stderr: '' };
  if (command === 'launchctl') return { code: 0, stdout: `state = running\n\tpid = 4242\n${args.join(' ')}`, stderr: '' };
  return { code: 127, stdout: '', stderr: '' };
};

const files = {
  '/h/.claude.json': JSON.stringify({ mcpServers: { telegram: { env: { TOKEN: SECRET } }, 'neo3-threads': { env: { KEY: SECRET } } } }),
  '/h/.codex/config.toml': '[mcp_servers.neo3-threads]\ncommand = "node"\nkey = "' + SECRET + '"\n',
  '/h/.codex/auth.json': SECRET,
};

test('runDoctor covers every area and never prints secret values', async () => {
  const doctor = createDoctor({ exec: goodExec, fs: memoryFs(files), home: '/h', platform: 'darwin', uid: 501, databasePath: '/h/.cloudcli/auth.db' });
  const report = await doctor.runDoctor();
  const ids = report.checks.map((c) => c.id);
  assert.deepEqual(ids, [
    'engine.claude', 'engine.codex', 'engine.grok', 'mcp.servers', 'mcp.threads', 'ollama', 'disk', 'database', 'service',
  ]);
  const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  assert.equal(byId['engine.claude'].status, 'ok');
  assert.match(byId['engine.claude'].detail, /версия 2\.1\.5/);
  assert.equal(byId['engine.grok'].status, 'warn');
  assert.match(byId['mcp.servers'].detail, /telegram, neo3-threads/);
  assert.equal(byId['mcp.threads'].status, 'ok');
  assert.equal(byId.ollama.status, 'ok');
  assert.match(byId.disk.detail, /50\.0 ГБ/);
  assert.match(byId.database.detail, /5\.0 МБ/);
  assert.match(byId.service.detail, /pid 4242/);
  assert.ok(!JSON.stringify(report).includes(SECRET));
});

test('runDoctor marks problems as warn/fail and unreadable parts as unknown', async () => {
  const exec: DiagExec = async (command) => {
    if (command === 'claude') return { code: 127, stdout: '', stderr: '' };
    if (command === 'curl') return { code: 0, stdout: '000', stderr: '' };
    if (command === 'df') return { code: 0, stdout: 'h\n/dev/x 1 1 2097152 1% /\n', stderr: '' };
    if (command === 'launchctl') return { code: 113, stdout: '', stderr: '' };
    return { code: 127, stdout: '', stderr: '' };
  };
  const report = await createDoctor({ exec, fs: memoryFs({}), home: '/h', platform: 'darwin', uid: 1, databasePath: '/h/missing.db' }).runDoctor();
  const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  assert.equal(byId['engine.claude'].status, 'fail');
  assert.equal(byId['mcp.servers'].status, 'unknown');
  assert.equal(byId['mcp.threads'].status, 'unknown');
  assert.equal(byId.ollama.status, 'warn');
  assert.equal(byId.disk.status, 'fail');
  assert.equal(byId.database.status, 'warn');
  assert.equal(byId.service.status, 'fail');
});

test('a crashing command becomes unknown, not an exception', async () => {
  const exec: DiagExec = async () => { throw new Error('boom'); };
  const report = await createDoctor({ exec, fs: memoryFs({}), home: '/h', platform: 'linux' }).runDoctor();
  assert.equal(report.checks.find((c) => c.id === 'disk')?.status, 'unknown');
  assert.equal(report.checks.find((c) => c.id === 'service')?.status, 'unknown');
});

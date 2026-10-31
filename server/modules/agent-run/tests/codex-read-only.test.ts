import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';

import { readCodeSnapshot, readOnlyCodexOptions, runCodexReadOnly } from '../codex-read-only.js';

test('analysis snapshot omits secrets, dependencies, symlinks and oversized files', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'README.md'), 'public code');
  await fs.writeFile(path.join(dir, '.env'), 'SECRET_SENTINEL');
  await fs.writeFile(path.join(dir, 'credentials.json'), 'SECRET_SENTINEL');
  await fs.writeFile(path.join(dir, 'big.ts'), 'SECRET_SENTINEL'.repeat(10000));
  await fs.mkdir(path.join(dir, 'node_modules'));
  await fs.writeFile(path.join(dir, 'node_modules', 'index.ts'), 'SECRET_SENTINEL');
  await fs.symlink(path.join(dir, '.env'), path.join(dir, 'linked.md'));
  const snapshot = await readCodeSnapshot(dir);
  assert.match(snapshot, /public code/);
  assert.doesNotMatch(snapshot, /SECRET_SENTINEL/);
});

test('read-only Codex never inherits MCP credentials or executable tool settings', () => {
  const options = readOnlyCodexOptions('/tmp/fixture');
  assert.equal(options.env.HOME, '/tmp/fixture');
  assert.equal(options.env.CODEX_HOME, '/tmp/fixture/.codex');
  assert.equal(options.env.OPENAI_API_KEY, undefined);
  assert.equal(options.env.NEO3_THREADS_TOKEN, undefined);
  assert.equal(options.config.features.shell_tool, false);
  assert.equal(options.config.features.hooks, false);
  assert.equal(options.config.features.plugins, false);
  assert.equal(options.config.features.apps, false);
  assert.equal(options.config.web_search, 'disabled');
});

test('analysis uses an isolated read-only thread and cleans it after failure', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const authDir = path.join(dir, 'auth');
  await fs.mkdir(authDir);
  await fs.writeFile(path.join(authDir, 'auth.json'), '{}');
  const old = process.env.CODEX_HOME;
  process.env.CODEX_HOME = authDir;
  t.after(() => { if (old === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = old; });
  let scratch = '';
  t.mock.method(Codex.prototype, 'startThread', (options: { workingDirectory: string; sandboxMode: string; approvalPolicy: string }) => {
    scratch = options.workingDirectory;
    assert.notEqual(scratch, dir);
    assert.equal(options.sandboxMode, 'read-only');
    assert.equal(options.approvalPolicy, 'never');
    return { run: async () => { throw new Error('fixture failure'); } };
  });
  await assert.rejects(runCodexReadOnly({ projectPath: dir, prompt: 'brief' }), /fixture failure/);
  await assert.rejects(fs.access(scratch));
  assert.equal(await fs.readFile(path.join(authDir, 'auth.json'), 'utf8'), '{}');
});

import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from './modules/database/index.js';
import { spawnGrok } from './grok-cli.js';

// «Перенести» in a Grok chat: the handoff turn must be able to write its note
// into <project>/docs/handoff/. A plain Grok chat runs in `auto` mode, where
// a headless write the safety check does not like fails outright (Grok
// docs, 22-permissions-and-safety). The gateway marks the handoff turn with
// `autoRelayNoteDir` for every engine; Grok has to turn it into an allow rule
// for exactly that folder. A stand-in CLI records the argv it was given.

async function argvOfRun(directory, options) {
  const argvFile = path.join(directory, `argv-${Math.random().toString(36).slice(2)}.txt`);
  const cli = path.join(directory, 'fake-grok');
  await writeFile(cli, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${argvFile}"\necho '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s"}'\n`);
  await chmod(cli, 0o755);
  const ws = { send() {} };
  await spawnGrok('Переносим работу в новый чат (эстафета ab12).', { projectPath: directory, cwd: directory, skipStopHooks: true, ...options }, ws);
  return (await readFile(argvFile, 'utf8')).split('\n');
}

test('the Grok handoff turn may write its note into docs/handoff — and only there', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grok relay note '));
  const previous = { db: process.env.DATABASE_PATH, cli: process.env.GROK_CLI_PATH };
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  process.env.GROK_CLI_PATH = path.join(directory, 'fake-grok');
  const noteDir = path.join(directory, 'docs', 'handoff');
  const allowRules = (argv) => argv.flatMap((arg, index) => (argv[index - 1] === '--allow' ? [arg] : []));
  try {
    const handoff = await argvOfRun(directory, { permissionMode: 'default', autoRelayNoteDir: noteDir });
    assert.equal(handoff[handoff.indexOf('--permission-mode') + 1], 'auto');
    assert.ok(allowRules(handoff).includes(`Edit(${noteDir}/*.md)`), allowRules(handoff).join(' | '));
    assert.ok(allowRules(handoff).every((rule) => rule.startsWith(`Edit(${noteDir}/`)));

    // An ordinary turn gets no extra permission.
    assert.deepEqual(allowRules(await argvOfRun(directory, { permissionMode: 'default' })), []);
  } finally {
    closeConnection();
    if (previous.db === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous.db;
    if (previous.cli === undefined) delete process.env.GROK_CLI_PATH;
    else process.env.GROK_CLI_PATH = previous.cli;
    await rm(directory, { recursive: true, force: true });
  }
});

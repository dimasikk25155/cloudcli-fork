import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveKimiPermissionOptions, spawnKimi } from './kimi-cli.js';
import { closeConnection } from './modules/database/connection.js';
import { initializeDatabase } from './modules/database/init-db.js';

/**
 * Hermetic DB for tests that pass a sessionId: spawnKimi's resume path asks
 * providerModelsService for a stored session model override, which queries
 * the sessions table. Without isolation that query hits the AMBIENT database
 * file — fine in isolation, but it races the live prod server / other test
 * files in a full-suite run and fails with SQLITE_ERROR. Point the connection
 * at a fresh, migrated temp DB instead (same pattern as
 * provider-models.service.test.ts).
 */
async function withIsolatedDatabase(runTest) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'kimi-cli-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('Kimi headless runs never receive permission flags', () => {
  // `kimi -p` auto-approves everything and rejects --yolo/--auto/--plan
  // ("Cannot combine --prompt with ..."), so the mapping must stay empty.
  for (const mode of ['default', 'plan', 'acceptEdits', 'bypassPermissions', undefined]) {
    assert.deepEqual(resolveKimiPermissionOptions(mode), { args: [], env: {} });
  }
});

async function createFakeKimiExecutable(binDir) {
  const scriptPath = path.join(binDir, 'kimi.js');
  await writeFile(scriptPath, `
const capturePath = process.env.KIMI_ARGS_CAPTURE;
if (capturePath) {
  require('node:fs').writeFileSync(capturePath, JSON.stringify({ args: process.argv.slice(2) }));
}

const events = [
  { role: 'assistant', content: 'assistant response' },
  { role: 'meta', type: 'session.resume_hint', session_id: 'session_live-1', command: 'kimi -r session_live-1' },
];

for (const event of events) {
  console.log(JSON.stringify(event));
}
`, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'kimi.cmd');
    await writeFile(commandPath, '@echo off\r\nnode "%~dp0kimi.js" %*\r\n', 'utf8');
    return commandPath;
  }

  const commandPath = path.join(binDir, 'kimi');
  await writeFile(commandPath, '#!/bin/sh\nnode "$(dirname "$0")/kimi.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
  return commandPath;
}

test('spawnKimi builds headless args and emits session_created from the meta line', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'kimi-cli-live-'));
  const argsCapturePath = path.join(tempRoot, 'kimi-args.json');
  const previousCliPath = process.env.KIMI_CLI_PATH;
  const previousArgsCapture = process.env.KIMI_ARGS_CAPTURE;
  const messages = [];
  const writer = {
    userId: null,
    sessionId: null,
    send(message) {
      messages.push(message);
    },
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    },
  };

  try {
    const kimiBinary = await createFakeKimiExecutable(tempRoot);
    process.env.KIMI_CLI_PATH = kimiBinary;
    process.env.KIMI_ARGS_CAPTURE = argsCapturePath;

    await spawnKimi('Hi', { cwd: tempRoot, model: 'kimi-code/k3' }, writer);

    const sessionCreatedIndex = messages.findIndex((message) => message.kind === 'session_created');
    const textIndex = messages.findIndex((message) =>
      message.kind === 'text' && message.content === 'assistant response');
    const complete = messages.find((message) => message.kind === 'complete');

    assert.notEqual(sessionCreatedIndex, -1);
    assert.notEqual(textIndex, -1);
    // Kimi protocol difference vs opencode: the session id only exists in the
    // end-of-run meta resume_hint line, so session_created lands AFTER the
    // content, not before it. This pins the contract deliberately.
    assert.ok(sessionCreatedIndex > textIndex);
    assert.equal(messages[sessionCreatedIndex].newSessionId, 'session_live-1');
    assert.equal(writer.sessionId, 'session_live-1');
    assert.equal(complete?.sessionId, 'session_live-1');
    assert.equal(messages.some((message) => message.kind === 'error'), false);

    const capture = JSON.parse(await readFile(argsCapturePath, 'utf8'));
    const launchedArgs = capture.args;
    assert.ok(Array.isArray(launchedArgs));
    assert.deepEqual(launchedArgs, ['-p', 'Hi', '--output-format', 'stream-json', '-m', 'kimi-code/k3']);
  } finally {
    if (previousCliPath === undefined) {
      delete process.env.KIMI_CLI_PATH;
    } else {
      process.env.KIMI_CLI_PATH = previousCliPath;
    }

    if (previousArgsCapture === undefined) {
      delete process.env.KIMI_ARGS_CAPTURE;
    } else {
      process.env.KIMI_ARGS_CAPTURE = previousArgsCapture;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('spawnKimi passes -r <sessionId> when resuming', async () => {
  await withIsolatedDatabase(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'kimi-cli-resume-'));
    const argsCapturePath = path.join(tempRoot, 'kimi-args.json');
    const previousCliPath = process.env.KIMI_CLI_PATH;
    const previousArgsCapture = process.env.KIMI_ARGS_CAPTURE;
    const writer = {
      userId: null,
      sessionId: null,
      send() {},
      setSessionId(sessionId) {
        this.sessionId = sessionId;
      },
    };

    try {
      const kimiBinary = await createFakeKimiExecutable(tempRoot);
      process.env.KIMI_CLI_PATH = kimiBinary;
      process.env.KIMI_ARGS_CAPTURE = argsCapturePath;

      await spawnKimi('Hi again', { cwd: tempRoot, sessionId: 'session_prev-9' }, writer);

      const capture = JSON.parse(await readFile(argsCapturePath, 'utf8'));
      assert.deepEqual(
        capture.args,
        ['-p', 'Hi again', '--output-format', 'stream-json', '-r', 'session_prev-9'],
      );
    } finally {
      if (previousCliPath === undefined) {
        delete process.env.KIMI_CLI_PATH;
      } else {
        process.env.KIMI_CLI_PATH = previousCliPath;
      }

      if (previousArgsCapture === undefined) {
        delete process.env.KIMI_ARGS_CAPTURE;
      } else {
        process.env.KIMI_ARGS_CAPTURE = previousArgsCapture;
      }

      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

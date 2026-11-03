import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import pty from 'node-pty';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb, userProjectAccessDb } from '@/modules/database/index.js';
import { jailCodexHome, jailSupported } from '@/shared/user-jail.js';

import { handleShellConnection } from '../services/shell-websocket.service.js';

test('Codex terminal stays attached to its jail and private home when resumed or restarted', { skip: !jailSupported() }, async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'shell-codex-compat-')));
  const previous = { database: process.env.DATABASE_PATH, codex: process.env.CODEX_HOME, jail: process.env.NEO3_USER_JAIL };
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await mkdir(project);
  await writeFile(path.join(home, '.codex', 'auth.json'), '{}');
  await writeFile(path.join(home, '.codex', 'config.toml'), 'model = "gpt-6.1-sol"\n[mcp_servers.private]\ncommand = "private-tool"\n');
  t.mock.method(os, 'homedir', () => home);
  delete process.env.CODEX_HOME;
  delete process.env.NEO3_USER_JAIL;
  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();
  const exits: Array<() => void> = [];
  const launches: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  t.mock.method(pty, 'spawn', (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    launches.push({ command, args, env: options.env });
    return { onData() {}, onExit(fn: () => void) { exits.push(fn); }, kill() {} };
  });
  try {
    const admin = Number(userDb.createUserWithRole('fixture-admin', 'x', 'admin').id);
    const teammate = Number(userDb.createUserWithRole('fixture-user', 'x', 'user').id);
    sessionsDb.createSession('native-fixture', 'codex', project, 'fixture');
    userProjectAccessDb.grantAccess(teammate, projectsDb.getProjectPath(project)!.project_id, admin);
    for (const [userId, hasSession, isPlainShell] of [[teammate, true, false], [admin, false, false], [teammate, false, true]] as const) {
      const socket = Object.assign(new EventEmitter(), { readyState: 1, send(_data: string) {} });
      handleShellConnection(socket as never, {
        resolveProviderSessionId: () => 'native-fixture', stripAnsiSequences: value => value,
        normalizeDetectedUrl: () => null, extractUrlsFromText: () => [], shouldAutoOpenUrlFromOutput: () => false,
      }, { user: { userId } } as never);
      const listener = socket.listeners('message')[0] as (data: Buffer) => Promise<void>;
      await listener(Buffer.from(JSON.stringify({ type: 'init', provider: 'codex', projectPath: project, sessionId: hasSession ? 'native-fixture' : null, hasSession, isPlainShell })));
    }
    assert.equal(launches.length, 3);
    const [jailed, free, plain] = launches;
    assert.equal(jailed.command, '/usr/bin/sandbox-exec');
    assert.match(jailed.args.at(-1)!, /codex --no-daemon --sandbox danger-full-access resume "native-fixture" \|\| codex --no-daemon --sandbox danger-full-access$/);
    const privateHome = jailCodexHome({ root: project, userId: teammate }, home);
    assert.equal(jailed.env.CODEX_HOME, privateHome);
    assert.equal(plain.env.CODEX_HOME, privateHome);
    assert.doesNotMatch(await readFile(path.join(privateHome, 'config.toml'), 'utf8'), /private-tool/);
    assert.notEqual(free.command, '/usr/bin/sandbox-exec');
    assert.equal(free.args.at(-1), 'codex --no-daemon');
    assert.equal(free.env.CODEX_HOME, undefined);
  } finally {
    for (const exit of exits) (exit as (value: { exitCode: number }) => void)({ exitCode: 0 });
    closeConnection();
    for (const [key, value] of [['DATABASE_PATH', previous.database], ['CODEX_HOME', previous.codex], ['NEO3_USER_JAIL', previous.jail]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

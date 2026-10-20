import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, userDb } from '@/modules/database/index.js';
import {
  buildJailProfile,
  jailCommand,
  jailInstruction,
  jailSupported,
  prepareCodexHome,
  SANDBOX_EXEC,
  userJailFor,
} from '@/shared/user-jail.js';

test('userJailFor: admins run free, teammates are fenced to the project folder', async (t) => {
  const tempDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'user-jail-')));
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSwitch = process.env.NEO3_USER_JAIL;
  t.after(async () => {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSwitch === undefined) delete process.env.NEO3_USER_JAIL;
    else process.env.NEO3_USER_JAIL = previousSwitch;
    await rm(tempDirectory, { recursive: true, force: true });
  });
  delete process.env.NEO3_USER_JAIL;
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  const dima = Number(userDb.createUserWithRole('dima', 'hash', 'admin').id);
  const slavik = Number(userDb.createUserWithRole('slavik', 'hash', 'user').id);
  const project = path.join(tempDirectory, 'project');
  await mkdir(project);

  assert.equal(userJailFor(dima, project), null);
  if (!jailSupported()) return;

  assert.deepEqual(userJailFor(slavik, project), { root: project, userId: slavik });
  // Unknown user is not an admin: fenced, never free.
  assert.deepEqual(userJailFor(999, project), { root: project, userId: 999 });
  // No folder to fence to → the run must not start.
  assert.equal(userJailFor(slavik, null), 'deny');
  assert.equal(userJailFor(slavik, path.join(tempDirectory, 'missing')), 'deny');
  assert.equal(userJailFor(slavik, '/'), 'deny');

  process.env.NEO3_USER_JAIL = 'off';
  assert.equal(userJailFor(slavik, project), null);
});

test('buildJailProfile: home closed, project open, Dima history closed again', () => {
  const profile = buildJailProfile({ root: '/Users/d/Work/proj "x"' }, '/Users/d', '/Users/d/app');
  assert.match(profile, /\(deny file-read\* file-write\* \(subpath "\/Users\/d"\) \(subpath "\/Volumes"\)\)/);
  assert.match(profile, /\(allow file-read\* file-write\* \(subpath "\/Users\/d\/Work\/proj \\"x\\""\)\)$/);
  assert.match(profile, /\(deny file-read\* \(literal "\/Users\/d\/\.claude\/history\.jsonl"\)/);
  assert.doesNotMatch(profile, /\.claude\\?\.json/, '~/.claude.json holds MCP keys — never opened');
  assert.doesNotMatch(profile, /\(subpath "\/Users\/d\/\.codex"\)/, "Dima's Codex chats — never opened");
  assert.match(profile, /\(subpath "\/Users\/d\/app\/dist-server"\)/);
  assert.doesNotMatch(profile, /\(subpath "\/Users\/d\/app"\)/, 'the app folder holds .env — never opened whole');
  // Own transcripts only: ~/.claude/projects/<cwd with non-alphanumerics → '-'>.
  assert.match(profile, /-Users-d-Work-proj--x-/);

  const readOnly = buildJailProfile({ root: '/Users/d/p', readOnly: true }, '/Users/d', null);
  assert.match(readOnly, /\(allow file-read\* \(subpath "\/Users\/d\/p"\)\)$/);

  assert.deepEqual(jailCommand({ root: '/p' }, '/bin/sh', ['-c', 'ls']).args.slice(-3), ['/bin/sh', '-c', 'ls']);
  assert.equal(jailCommand({ root: '/p' }, '/bin/sh', []).command, SANDBOX_EXEC);
  assert.match(jailInstruction({ root: '/p' }), /Диме/);
});

test('the jail really holds: inside the project yes, above it no', { skip: !jailSupported() }, async (t) => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'user-jail-home-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'Projects', 'mine');
  await mkdir(project, { recursive: true });
  await writeFile(path.join(home, 'Projects', '.secrets.env'), 'KEY=1\n');
  await writeFile(path.join(project, 'readme.txt'), 'hello\n');

  const { command, args } = {
    command: SANDBOX_EXEC,
    args: ['-p', buildJailProfile({ root: project, userId: 7 }, home, null)],
  };
  const run = (script: string) => spawnSync(command, [...args, '/bin/sh', '-c', script], { cwd: project, encoding: 'utf8' });

  // Dima's MCP keys, Codex chats and other projects' Grok chats stay closed;
  // the teammate's own Codex folder and this project's Grok chats are open.
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await writeFile(path.join(home, '.claude.json'), '{"mcpServers":{}}');
  await writeFile(path.join(home, '.codex', 'history.jsonl'), 'dima\n');
  await writeFile(path.join(home, '.codex', 'auth.json'), '{}');
  const otherGrok = path.join(home, '.grok', 'sessions', encodeURIComponent(path.join(home, 'Projects', 'other')));
  const ownGrok = path.join(home, '.grok', 'sessions', encodeURIComponent(project));
  await mkdir(otherGrok, { recursive: true });
  await mkdir(ownGrok, { recursive: true });
  await writeFile(path.join(otherGrok, 'chat.jsonl'), 'other\n');
  await writeFile(path.join(ownGrok, 'chat.jsonl'), 'own\n');
  const codexHome = prepareCodexHome({ root: project, userId: 7 }, home);
  assert.notEqual(run(`cat ${JSON.stringify(path.join(home, '.claude.json'))}`).status, 0);
  assert.notEqual(run(`cat ${JSON.stringify(path.join(home, '.codex', 'history.jsonl'))}`).status, 0);
  assert.notEqual(run(`cat ${JSON.stringify(path.join(otherGrok, 'chat.jsonl'))}`).status, 0);
  assert.equal(run(`cat ${JSON.stringify(path.join(ownGrok, 'chat.jsonl'))}`).stdout, 'own\n');
  assert.equal(run(`cat ${JSON.stringify(path.join(codexHome, 'auth.json'))}`).stdout, '{}');
  assert.equal(run(`echo x > ${JSON.stringify(path.join(codexHome, 'note'))}`).status, 0);

  assert.equal(run('cat readme.txt').stdout, 'hello\n');
  assert.equal(run('echo ok > new.txt && cat new.txt').stdout, 'ok\n');
  assert.notEqual(run('cat ../.secrets.env').status, 0);
  assert.notEqual(run('ls ..').status, 0);
  assert.notEqual(run('echo x > ../escape.txt').status, 0);
  assert.equal(spawnSync('/bin/test', ['-e', path.join(home, 'Projects', 'escape.txt')]).status, 1);

  // Read-only jail: reading yes, writing no.
  const ro = buildJailProfile({ root: project, readOnly: true }, home, null);
  assert.equal(execFileSync(SANDBOX_EXEC, ['-p', ro, '/bin/cat', 'readme.txt'], { cwd: project, encoding: 'utf8' }), 'hello\n');
  assert.notEqual(spawnSync(SANDBOX_EXEC, ['-p', ro, '/usr/bin/touch', 'w.txt'], { cwd: project }).status, 0);
});

test('prepareCodexHome: shared sign-in, Dima model settings, only the threads MCP server', async (t) => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'user-jail-codex-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, '.codex'));
  await writeFile(path.join(home, '.codex', 'auth.json'), '{"token":"t"}');
  await writeFile(path.join(home, '.codex', 'config.toml'), [
    'model = "gpt-x"',
    'notify = ["/bin/echo"]',
    '[projects."/Users/d/secret"]',
    'trust_level = "trusted"',
    '[mcp_servers.telegram]',
    'command = "tg"',
    '[mcp_servers.neo3-threads]',
    'command = "node"',
    'args = ["threads-mcp.js"]',
    '',
  ].join('\n'));
  const dir = prepareCodexHome({ root: '/work/proj', userId: 3 }, home);
  assert.equal(dir, path.join(home, '.cloudcli', 'jail', 'users', '3', 'codex'));
  assert.equal(readFileSync(path.join(dir, 'auth.json'), 'utf8'), '{"token":"t"}');
  const config = readFileSync(path.join(dir, 'config.toml'), 'utf8');
  assert.match(config, /model = "gpt-x"/);
  assert.match(config, /neo3-threads/);
  assert.doesNotMatch(config, /telegram|notify|secret/);
  assert.match(config, /\/work\/proj/);
  // Second run: same folder, link kept.
  assert.equal(prepareCodexHome({ root: '/work/proj', userId: 3 }, home), dir);
});

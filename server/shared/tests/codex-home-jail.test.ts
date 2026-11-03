import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildJailProfile, jailSupported, prepareCodexHome, SANDBOX_EXEC } from '../user-jail.js';

test('custom Codex home works for teammates without exposing owner history or MCP', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codex-jail-home-')));
  const previous = process.env.CODEX_HOME;
  const custom = path.join(root, 'owner-codex');
  const home = path.join(root, 'home');
  const project = path.join(home, 'project');
  process.env.CODEX_HOME = custom;
  try {
    await mkdir(custom);
    await mkdir(project, { recursive: true });
    await writeFile(path.join(custom, 'auth.json'), '{}');
    await writeFile(path.join(custom, 'history.jsonl'), 'PRIVATE_FIXTURE');
    await writeFile(path.join(custom, 'config.toml'), 'model = "fixture"\n[mcp_servers.private]\ncommand = "private"\n');
    const jail = { root: project, userId: 42 };
    const own = prepareCodexHome(jail, home);
    assert.equal(await readFile(path.join(own, 'auth.json'), 'utf8'), '{}');
    assert.match(await readFile(path.join(own, 'config.toml'), 'utf8'), /fixture/);
    assert.doesNotMatch(await readFile(path.join(own, 'config.toml'), 'utf8'), /mcp_servers\.private/);
    if (jailSupported()) {
      const profile = buildJailProfile(jail, home, null);
      const run = (file: string) => spawnSync(SANDBOX_EXEC, ['-p', profile, '/bin/cat', file], { cwd: project });
      assert.equal(run(path.join(custom, 'auth.json')).status, 0);
      assert.notEqual(run(path.join(custom, 'history.jsonl')).status, 0);
    }
    const nextHome = path.join(root, 'new-owner-codex');
    await mkdir(nextHome);
    await writeFile(path.join(nextHome, 'auth.json'), '{"fixture":true}');
    process.env.CODEX_HOME = nextHome;
    prepareCodexHome(jail, home);
    assert.equal(await readlink(path.join(own, 'auth.json')), path.join(nextHome, 'auth.json'),
      'an existing shared auth link must follow a changed owner CODEX_HOME');
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

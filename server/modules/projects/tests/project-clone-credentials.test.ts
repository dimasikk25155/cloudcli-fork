import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createPendingCloneRequests } from '@/modules/projects/services/project-clone-request.service.js';
import { buildGitCloneEnvironment, startCloneProject } from '@/modules/projects/services/project-clone.service.js';

// Synthetic canary: never a real credential.
const CANARY = 'ghp_CANARY0000synthetic0000token';

function mockGitProcess() {
  const emitter = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void };
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = () => emitter.emit('close', null);
  return emitter;
}

const baseDependencies = {
  validatePath: async () => ({ valid: true, resolvedPath: '/workspace/root' }),
  ensureDirectory: async () => undefined,
  pathExists: async () => false,
  removePath: async () => undefined,
  getGithubTokenById: async () => ({ github_token: CANARY }),
  registerProject: async () => ({ project: { projectId: 'p' } }),
  logError: () => undefined,
};

test('selected token never reaches git argv or the clone URL; it rides the scoped helper env only', async () => {
  const gitProcess = mockGitProcess();
  let captured: { url: string; clonePath: string; env: NodeJS.ProcessEnv } | null = null;
  const progress: string[] = [];

  const operation = await startCloneProject(
    { workspacePath: '/workspace/root', githubUrl: 'https://github.com/example/repo.git', githubTokenId: 7, userId: 1 },
    { onProgress: (message) => progress.push(message), onComplete: () => undefined },
    {
      ...baseDependencies,
      spawnGitClone: (url, clonePath, env) => {
        captured = { url, clonePath, env };
        return gitProcess as any;
      },
    },
  );

  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  const call = captured as unknown as { url: string; clonePath: string; env: NodeJS.ProcessEnv };
  assert.equal(call.url, 'https://github.com/example/repo.git');
  assert.ok(!call.clonePath.includes(CANARY));
  assert.equal(call.env.CLOUDCLI_GITHUB_TOKEN, CANARY);
  assert.equal(call.env.GIT_CONFIG_KEY_0, 'credential.helper');
  assert.equal(call.env.GIT_CONFIG_VALUE_0, '');
  assert.equal(call.env.GIT_CONFIG_KEY_1, 'credential.https://github.com.helper');
  assert.ok(!String(call.env.GIT_CONFIG_VALUE_1).includes(CANARY), 'helper reads the token from env, not inline');
  assert.ok(progress.every((message) => !message.includes(CANARY)));
});

test('a new token typed into the form is handled the same way', async () => {
  let env: NodeJS.ProcessEnv = {};
  let url = '';
  const gitProcess = mockGitProcess();
  const operation = await startCloneProject(
    { workspacePath: '/workspace/root', githubUrl: 'https://github.com/example/repo', newGithubToken: `  ${CANARY}  `, userId: 1 },
    { onProgress: () => undefined, onComplete: () => undefined },
    { ...baseDependencies, spawnGitClone: (u, _p, e) => { url = u; env = e; return gitProcess as any; } },
  );
  gitProcess.emit('close', 0);
  await operation.waitForCompletion;
  assert.ok(!url.includes(CANARY));
  assert.equal(env.CLOUDCLI_GITHUB_TOKEN, CANARY);
});

test('no token means no helper and no token variable', () => {
  const env = buildGitCloneEnvironment(null);
  assert.equal(env.CLOUDCLI_GITHUB_TOKEN, undefined);
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});

test('URLs that embed credentials are rejected before git runs, including encoded ones', async () => {
  const urls = [
    `https://${CANARY}@github.com/example/repo.git`,
    `https://x-access-token:${CANARY}@github.com/example/repo.git`,
    `https://user%40corp:${encodeURIComponent(CANARY)}@github.com/example/repo.git`,
    `http://${CANARY}@evil.example/repo.git`,
    `ssh://git:${CANARY}@github.com/example/repo.git`,
  ];
  for (const githubUrl of urls) {
    await assert.rejects(
      startCloneProject(
        { workspacePath: '/workspace/root', githubUrl, userId: 1 },
        { onProgress: () => undefined, onComplete: () => undefined },
        { ...baseDependencies, spawnGitClone: () => { throw new Error('git must not run'); } },
      ),
      (error: { code?: string; message?: string }) =>
        error.code === 'GITHUB_URL_CARRIES_CREDENTIALS' && !String(error.message).includes(CANARY),
      githubUrl,
    );
  }
});

test('unparsable http(s) URLs are rejected, scp-like SSH stays allowed', async () => {
  await assert.rejects(
    startCloneProject(
      { workspacePath: '/workspace/root', githubUrl: 'https://github.com:99999/x/y.git', userId: 1 },
      { onProgress: () => undefined, onComplete: () => undefined },
      { ...baseDependencies, spawnGitClone: () => { throw new Error('git must not run'); } },
    ),
    { code: 'INVALID_GITHUB_URL' },
  );

  const gitProcess = mockGitProcess();
  let url = '';
  const operation = await startCloneProject(
    { workspacePath: '/workspace/root', githubUrl: 'git@github.com:example/repo.git', userId: 1 },
    { onProgress: () => undefined, onComplete: () => undefined },
    { ...baseDependencies, spawnGitClone: (u) => { url = u; return gitProcess as any; } },
  );
  gitProcess.emit('close', 0);
  await operation.waitForCompletion;
  assert.equal(url, 'git@github.com:example/repo.git');
});

test('a split canary in stderr never becomes the final error text', async () => {
  const gitProcess = mockGitProcess();
  const operation = await startCloneProject(
    { workspacePath: '/workspace/root', githubUrl: 'https://github.com/example/repo.git', githubTokenId: 7, userId: 1 },
    { onProgress: () => undefined, onComplete: () => undefined },
    { ...baseDependencies, spawnGitClone: () => gitProcess as any },
  );
  gitProcess.stderr.write(`fatal: something ${CANARY}\n`);
  gitProcess.stderr.write('\n');
  await new Promise((resolve) => setImmediate(resolve));
  gitProcess.emit('close', 128);
  await assert.rejects(operation.waitForCompletion, (error: Error) => !error.message.includes(CANARY));
});

const hasGit = spawnSync('git', ['--version']).status === 0;

test('real git: helper answers github.com only, and origin in .git/config stays clean', { skip: !hasGit }, async () => {
  const env = buildGitCloneEnvironment(CANARY);
  const fill = (input: string) => spawnSync('git', ['credential', 'fill'], { input, env, encoding: 'utf8', timeout: 10_000 });

  const github = fill('protocol=https\nhost=github.com\npath=example/repo.git\n\n');
  assert.equal(github.status, 0, github.stderr);
  assert.match(github.stdout, new RegExp(`password=${CANARY}`));

  for (const other of ['protocol=https\nhost=evil.example\n\n', 'protocol=http\nhost=github.com\n\n']) {
    const result = fill(other);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(CANARY), other);
  }

  const root = mkdtempSync(path.join(os.tmpdir(), 'neo3-clone-canary-'));
  try {
    const source = path.join(root, 'source.git');
    execFileSync('git', ['init', '--bare', '-q', source]);
    const workspace = path.join(root, 'workspace');
    const progress: string[] = [];
    let completed = false;
    const operation = await startCloneProject(
      { workspacePath: workspace, githubUrl: `file://${source}`, newGithubToken: CANARY, userId: 1 },
      { onProgress: (message) => progress.push(message), onComplete: () => { completed = true; } },
      {
        validatePath: async () => ({ valid: true, resolvedPath: workspace }),
        registerProject: async () => ({ project: { projectId: 'p' } }),
      },
    );
    await operation.waitForCompletion;
    assert.equal(completed, true);
    const config = readFileSync(path.join(workspace, 'source', '.git', 'config'), 'utf8');
    assert.ok(!config.includes(CANARY));
    assert.ok(progress.every((message) => !message.includes(CANARY)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real git: a machine-level helper can neither shadow nor receive the selected token', { skip: !hasGit }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'neo3-clone-helper-'));
  try {
    const globalConfig = path.join(root, 'gitconfig');
    const stored = path.join(root, 'stored.txt');
    // A "keychain" that would answer with a stale password and record anything it is asked to store.
    execFileSync('git', ['config', '--file', globalConfig, 'credential.helper',
      `!f() { if [ "$1" = get ]; then echo username=stale; echo password=STALE_MACHINE_SECRET; else cat >> '${stored}'; fi; }; f`]);
    const env = { ...buildGitCloneEnvironment(CANARY), GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };
    const input = 'protocol=https\nhost=github.com\npath=example/repo.git\n\n';

    const fill = spawnSync('git', ['credential', 'fill'], { input, env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(fill.status, 0, fill.stderr);
    assert.match(fill.stdout, new RegExp(`password=${CANARY}`));
    assert.ok(!fill.stdout.includes('STALE_MACHINE_SECRET'));

    spawnSync('git', ['credential', 'approve'], { input: fill.stdout, env, encoding: 'utf8', timeout: 10_000 });
    let recorded = '';
    try { recorded = readFileSync(stored, 'utf8'); } catch { /* nothing stored */ }
    assert.ok(!recorded.includes(CANARY), 'machine helper must not store the token');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pending clone requests are single-use and bound to the posting user', () => {
  const pending = createPendingCloneRequests(60_000);
  const request = { workspacePath: '/w', githubUrl: 'https://github.com/a/b', githubTokenId: null, newGithubToken: CANARY };
  const id = pending.add(1, request);
  assert.ok(!id.includes(CANARY));
  assert.equal(pending.claim(id, 2), null, 'another user cannot claim it');
  assert.deepEqual(pending.claim(id, 1), request);
  assert.equal(pending.claim(id, 1), null, 'second claim fails');
});

test('pending clone requests expire', async () => {
  const pending = createPendingCloneRequests(5);
  const id = pending.add(1, { workspacePath: '/w', githubUrl: 'u', githubTokenId: null, newGithubToken: null });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(pending.claim(id, 1), null);
});

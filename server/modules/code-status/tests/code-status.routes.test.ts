import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { createCodeStatusRouter, createCodeStatusService } from '@/modules/code-status/index.js';
import { isAdminUser } from '@/shared/project-access.js';

// No machine git config for the fixtures or for the service's own git calls.
Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });

// GET /api/projects/:projectId/code-status: who may look, and that only an
// admin (by the database role) gets the site part.

const FAKE_TOKEN = 'vercel-route-token-987654321';

type Fixture = {
  adminId: number;
  memberId: number;
  projectId: string;
  vercelCalls: () => number;
  /** Moves the service clock forward (cache and refresh throttle). */
  advance: (ms: number) => void;
  get: (userId: number, role: string, projectId: string, query?: string) => Promise<Response>;
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  }).trim();
}

async function withServer(runTest: (fixture: Fixture) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousToken = process.env.VERCEL_TOKEN;
  delete process.env.VERCEL_TOKEN;
  const tempDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'code-status-route-')));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  // A Vercel-linked repository with one uncommitted file.
  const repo = path.join(tempDirectory, 'shop');
  await mkdir(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  await writeFile(path.join(repo, 'README.md'), 'hi\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-q', '-m', 'first']);
  const head = git(repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, '.git', 'info', 'exclude'), '.vercel\n');
  await mkdir(path.join(repo, '.vercel'));
  await writeFile(path.join(repo, '.vercel', 'project.json'), JSON.stringify({ orgId: 'team_t', projectId: 'prj_t' }));
  await writeFile(path.join(repo, 'draft.md'), 'wip\n');
  const secretsFile = path.join(tempDirectory, 'secrets.env');
  await writeFile(secretsFile, `VERCEL_TOKEN=${FAKE_TOKEN}\n`);

  let vercelCalls = 0;
  let clock = 1_000_000;
  const service = createCodeStatusService({
    now: () => clock,
    fetchImpl: async (url) => {
      vercelCalls += 1;
      const production = new URL(url).searchParams.get('target') === 'production';
      const deployments = production ? [{ url: 'shop.vercel.app', created: 1, meta: { githubCommitSha: head } }] : [];
      return { ok: true, status: 200, json: async () => ({ deployments }) };
    },
    secretsFile,
    registryFile: path.join(tempDirectory, 'none.yaml'),
  });

  const admin = userDb.createUserWithRole('dima', 'x', 'admin');
  const member = userDb.createUserWithRole('slava', 'x', 'user');
  const projectId = projectsDb.createProjectPath(repo).project!.project_id;

  const app = express();
  // Same mount as server/index.js, with authenticateToken stubbed by headers.
  app.use(
    '/api/projects/:projectId/code-status',
    (req, res, next) => {
      const id = req.headers['x-user-id'];
      if (!id) {
        res.sendStatus(401);
        return;
      }
      (req as express.Request & { user?: unknown }).user = { id: Number(id), role: req.headers['x-role'] };
      next();
    },
    createCodeStatusRouter(service),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await runTest({
      adminId: Number(admin.id),
      memberId: Number(member.id),
      projectId,
      vercelCalls: () => vercelCalls,
      advance: (ms) => {
        clock += ms;
      },
      get: (userId, role, id, query = '') =>
        fetch(`${base}/api/projects/${encodeURIComponent(id)}/code-status${query}`, {
          headers: { 'x-user-id': String(userId), 'x-role': role },
        }),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousToken !== undefined) process.env.VERCEL_TOKEN = previousToken;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('a user without access to the project gets 403 and nothing is computed', async () => {
  await withServer(async ({ memberId, projectId, get, vercelCalls }) => {
    const response = await get(memberId, 'user', projectId);
    assert.equal(response.status, 403);
    assert.equal(vercelCalls(), 0);
  });
});

test('an unknown project is 404', async () => {
  await withServer(async ({ adminId, get }) => {
    assert.equal((await get(adminId, 'admin', 'no-such-project')).status, 404);
  });
});

test('a granted member sees git only — even when the token claims admin', async () => {
  await withServer(async ({ adminId, memberId, projectId, get, vercelCalls }) => {
    userProjectAccessDb.grantAccess(memberId, projectId, adminId);

    const response = await get(memberId, 'admin', projectId);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { git: { uncommitted: number; lists: { files: string[] } }; site: unknown };
    assert.equal(body.git.uncommitted, 1);
    assert.deepEqual(body.git.lists.files, ['draft.md']);
    assert.equal(body.site, null);
    assert.equal(vercelCalls(), 0);
  });
});

test('the admin sees the site part; the token is not in the answer', async () => {
  await withServer(async ({ adminId, projectId, get }) => {
    const response = await get(adminId, 'admin', projectId);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes(FAKE_TOKEN));
    const body = JSON.parse(text);
    assert.equal(body.git.branch, 'main');
    assert.equal(body.site.kind, 'vercel');
    assert.equal(body.site.state, 'fresh');
  });
});

test('?refresh=1 bypasses the 60-second cache', async () => {
  await withServer(async ({ adminId, projectId, get, vercelCalls, advance }) => {
    await get(adminId, 'admin', projectId);
    const afterFirst = vercelCalls();
    advance(30_000);
    await get(adminId, 'admin', projectId);
    assert.equal(vercelCalls(), afterFirst, 'second look within 60 s is cached');
    await get(adminId, 'admin', projectId, '?refresh=1');
    assert.ok(vercelCalls() > afterFirst, 'refresh asks Vercel again');
  });
});

test('the site part follows the database admin role, not the null-project rule or the token', async () => {
  await withServer(async ({ adminId, memberId, projectId, get, vercelCalls }) => {
    // The explicit check the route uses: role from the database only.
    assert.equal(isAdminUser({ id: adminId, role: 'user' }), true);
    assert.equal(isAdminUser({ id: memberId, role: 'admin' }), false);
    assert.equal(isAdminUser({ id: 999_999, role: 'admin' }), false);
    assert.equal(isAdminUser(null), false);

    userProjectAccessDb.grantAccess(memberId, projectId, adminId);
    const member = (await (await get(memberId, 'admin', projectId, '?refresh=1')).json()) as { site: unknown; git: unknown };
    assert.equal(member.site, null);
    assert.ok(member.git);
    assert.equal(vercelCalls(), 0);

    // An admin demoted in the database (project still granted) loses the site part at once.
    userProjectAccessDb.grantAccess(adminId, projectId, adminId);
    userDb.setUserRole(adminId, 'user');
    const demoted = await get(adminId, 'admin', projectId, '?refresh=1');
    assert.equal(demoted.status, 200);
    assert.equal(((await demoted.json()) as { site: unknown }).site, null);
    assert.equal(vercelCalls(), 0);
  });
});

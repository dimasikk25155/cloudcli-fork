import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { relayRoutes } from '@/modules/relay/index.js';

type Reply = { status: number; body: { ok?: boolean; absPath?: string; error?: { code?: string } } };

type World = {
  project: string;
  outside: string;
  ask: (sessionId: string, filePath: unknown, as?: 'member' | 'stranger') => Promise<Reply>;
};

/**
 * Throwaway database and folders: a member granted one project (with a real
 * handoff note in docs/handoff), a stranger with no grants, a sibling folder
 * outside the project, and the relay route mounted like server/index.js does.
 */
async function withWorld(runTest: (world: World) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'relay-file-')));
  const project = path.join(root, 'My Project');
  const outside = path.join(root, 'outside');
  await mkdir(path.join(project, 'docs', 'handoff'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(project, 'docs', 'handoff', '2026-10-12 1200 relay.md'), '# эстафета\n');
  await writeFile(path.join(outside, 'secret.md'), 'чужое\n');

  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  await initializeDatabase();
  const server = await (async () => {
    const admin = userDb.createUserWithRole('owner', 'unused', 'admin');
    const member = userDb.createUserWithRole('member', 'unused', 'user');
    const stranger = userDb.createUserWithRole('stranger', 'unused', 'user');
    const created = projectsDb.createProjectPath(project).project!;
    userProjectAccessDb.grantAccess(Number(member.id), created.project_id, Number(admin.id));
    sessionsDb.createAppSession('relay-parent', 'claude', created.project_path);

    const users = { member: { id: Number(member.id) }, stranger: { id: Number(stranger.id) } };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const as = req.header('x-as') === 'stranger' ? 'stranger' : 'member';
      (req as Request & { user?: unknown }).user = users[as];
      next();
    });
    app.use('/api/sessions', relayRoutes);
    app.use((err: { statusCode?: number; code?: string; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode ?? 500).json({ success: false, error: { code: err.code, message: err.message } });
    });
    const listening = app.listen(0, '127.0.0.1');
    await once(listening, 'listening');
    return listening;
  })();

  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`;
  const ask = async (sessionId: string, filePath: unknown, as: 'member' | 'stranger' = 'member'): Promise<Reply> => {
    const response = await fetch(`${base}/${encodeURIComponent(sessionId)}/relay-file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-as': as },
      body: JSON.stringify({ path: filePath }),
    });
    return { status: response.status, body: (await response.json()) as Reply['body'] };
  };

  try {
    await runTest({ project, outside, ask });
  } finally {
    server.close();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(root, { recursive: true, force: true });
  }
}

const NOTE = 'docs/handoff/2026-10-12 1200 relay.md';

test('a note inside the project is accepted by relative and by absolute path', async () => {
  await withWorld(async ({ project, ask }) => {
    const expected = path.join(project, 'docs', 'handoff', '2026-10-12 1200 relay.md');

    const relative = await ask('relay-parent', NOTE);
    assert.equal(relative.status, 200);
    assert.deepEqual(relative.body, { ok: true, absPath: expected });

    const absolute = await ask('relay-parent', expected);
    assert.equal(absolute.status, 200);
    assert.deepEqual(absolute.body, { ok: true, absPath: expected });
  });
});

test('a file outside the project is refused', async () => {
  await withWorld(async ({ outside, ask }) => {
    const reply = await ask('relay-parent', path.join(outside, 'secret.md'));
    assert.equal(reply.status, 400);
    assert.notEqual(reply.body.ok, true);
    assert.equal(reply.body.absPath, undefined);
  });
});

test('a path with ".." is refused even when it would land inside the project', async () => {
  await withWorld(async ({ ask }) => {
    for (const candidate of ['../outside/secret.md', 'docs/../docs/handoff/2026-10-12 1200 relay.md']) {
      const reply = await ask('relay-parent', candidate);
      assert.equal(reply.status, 400, candidate);
      assert.equal(reply.body.absPath, undefined, candidate);
    }
  });
});

test('a symlink inside the project that points outside is refused', async () => {
  await withWorld(async ({ project, outside, ask }) => {
    await symlink(path.join(outside, 'secret.md'), path.join(project, 'docs', 'handoff', 'link.md'));
    const reply = await ask('relay-parent', 'docs/handoff/link.md');
    assert.equal(reply.status, 400);
    assert.equal(reply.body.absPath, undefined);
  });
});

test('a missing file, a folder or an empty path is refused', async () => {
  await withWorld(async ({ ask }) => {
    const missing = await ask('relay-parent', 'docs/handoff/nope.md');
    assert.equal(missing.status, 404);
    const folder = await ask('relay-parent', 'docs/handoff');
    assert.equal(folder.status, 404);
    for (const empty of ['', '   ', null, 42]) {
      const reply = await ask('relay-parent', empty);
      assert.equal(reply.status, 400, String(empty));
    }
  });
});

test('an unknown chat or a chat the user may not see is refused', async () => {
  await withWorld(async ({ ask }) => {
    const unknown = await ask('no-such-chat', NOTE);
    assert.equal(unknown.status, 404);
    const foreign = await ask('relay-parent', NOTE, 'stranger');
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.absPath, undefined);
  });
});

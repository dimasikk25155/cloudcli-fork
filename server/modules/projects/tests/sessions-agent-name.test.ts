import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  agentsDb,
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import projectRoutes from '@/modules/projects/projects.routes.js';

import { getArchivedProjectsWithSessions, getProjectSessionsPage } from '../services/projects-with-sessions-fetch.service.js';

// Story 3: a chat with an agent is marked with the agent's name in the sidebar
// list, next to `links`.

test('sidebar sessions carry agentName for chats of an agent, nothing for other chats', async () => {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'sessions-agent-name-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const admin = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const project = projectsDb.createProjectPath(path.join(directory, 'tyres')).project!;
    agentsDb.create({
      id: 'artist', userId: admin, name: 'Художник', role: 'r', checks: '', provider: 'grok', model: 'grok-4.7', effort: null, projectPath: project.project_path, files: [],
    });
    sessionsDb.createAppSession('agent-chat', 'grok', project.project_path);
    sessionsDb.createAppSession('plain-chat', 'grok', project.project_path);
    agentsDb.linkSession('agent-chat', 'artist', admin);

    const page = await getProjectSessionsPage(project.project_id, { requestingUser: { id: admin, role: 'admin' } });
    const byId = new Map(page.sessions.map((session) => [session.id, session]));
    assert.equal(byId.get('agent-chat')?.agentName, 'Художник');
    assert.ok(byId.get('agent-chat')?.links, 'links stay where they were');
    assert.equal(byId.get('plain-chat')?.agentName, undefined);
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

// Security: agents are an admin tool. A teammate with access to the project
// sees the chats, but not which agent ran them.
test('a teammate with access to the project gets no agentName from any sidebar list; the admin does', async () => {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'sessions-agent-name-member-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const app = express();
  // Stand-in for authenticateToken: the user id comes from a header, the role from the database.
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-user'));
    const row = id ? userDb.getUserById(id) : undefined;
    if (row) (req as typeof req & { user?: unknown }).user = { id: row.id, role: row.role };
    next();
  });
  app.use('/api/projects', projectRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
  try {
    const admin = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const member = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
    const project = projectsDb.createProjectPath(path.join(directory, 'tyres')).project!;
    userProjectAccessDb.grantAccess(member, project.project_id, admin);
    agentsDb.create({
      id: 'artist', userId: admin, name: 'Художник', role: 'r', checks: '', provider: 'grok', model: 'grok-4.7', effort: null, projectPath: project.project_path, files: [],
    });
    sessionsDb.createAppSession('agent-chat', 'grok', project.project_path);
    agentsDb.linkSession('agent-chat', 'artist', admin);

    const as = (id: number) => ({ headers: { 'x-test-user': String(id) } });
    type Listed = { id: string; agentName?: string };

    const memberPage = await fetch(`${base}/${project.project_id}/sessions`, as(member));
    assert.equal(memberPage.status, 200);
    const memberSessions = ((await memberPage.json()) as { sessions: Listed[] }).sessions;
    assert.deepEqual(memberSessions.map((session) => session.id), ['agent-chat'], 'the teammate sees the chat itself');
    assert.equal(memberSessions[0].agentName, undefined, 'but not the agent label');

    const memberProjects = await fetch(`${base}?skipSync=1`, as(member));
    const listed = ((await memberProjects.json()) as Array<{ sessions: Listed[] }>).flatMap((entry) => entry.sessions);
    assert.deepEqual(listed.map((session) => session.id), ['agent-chat']);
    assert.equal(listed[0].agentName, undefined);

    const adminPage = await fetch(`${base}/${project.project_id}/sessions`, as(admin));
    assert.equal(((await adminPage.json()) as { sessions: Listed[] }).sessions[0].agentName, 'Художник');
    const adminProjects = await fetch(`${base}?skipSync=1`, as(admin));
    assert.equal(((await adminProjects.json()) as Array<{ sessions: Listed[] }>)[0].sessions[0].agentName, 'Художник');

    // Archived view: the same rule.
    projectsDb.updateProjectIsArchived(project.project_path, true);
    const memberArchived = (await getArchivedProjectsWithSessions({ skipSynchronization: true, requestingUser: { id: member, role: 'user' } }))
      .flatMap((entry) => entry.sessions);
    assert.deepEqual(memberArchived.map((session) => session.id), ['agent-chat']);
    assert.equal(memberArchived[0].agentName, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

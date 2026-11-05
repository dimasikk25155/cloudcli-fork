import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { agentsDb, closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb } from '@/modules/database/index.js';

import { getProjectSessionsPage } from '../services/projects-with-sessions-fetch.service.js';

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

    const page = await getProjectSessionsPage(project.project_id);
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

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { agentsDb, closeConnection, getConnection, initializeDatabase, userDb } from '@/modules/database/index.js';

async function withDatabase(prepare: ((databasePath: string) => void) | null, run: () => void | Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'agents-db-'));
  const previous = process.env.DATABASE_PATH;
  const databasePath = path.join(directory, 'auth.db');
  closeConnection();
  prepare?.(databasePath);
  process.env.DATABASE_PATH = databasePath;
  try {
    await initializeDatabase();
    await run();
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

function columnsOf(table: string): string[] {
  return (getConnection().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name).sort();
}

const AGENT_COLUMNS = ['checks', 'created_at', 'effort', 'files', 'id', 'model', 'name', 'project_path', 'provider', 'role', 'updated_at', 'user_id'];

test('a fresh database has the agents, rules, agent chats and queue tables', async () => {
  await withDatabase(null, () => {
    assert.deepEqual(columnsOf('agents'), AGENT_COLUMNS);
    for (const column of ['id', 'agent_id', 'text', 'created_at', 'removed_at', 'version_added', 'version_removed']) {
      assert.ok(columnsOf('agent_rules').includes(column), `agent_rules.${column}`);
    }
    assert.deepEqual(columnsOf('agent_sessions'), ['agent_id', 'created_at', 'session_id', 'user_id']);
    assert.deepEqual(columnsOf('agent_queues'), [
      'agent_id', 'created_at', 'finished_at', 'id', 'max_attempts', 'notified_at', 'parallel', 'status', 'template', 'title', 'updated_at', 'user_id',
    ]);
    assert.deepEqual(columnsOf('agent_queue_items'), [
      'attempts', 'excerpt', 'id', 'input', 'manual', 'pass', 'position', 'queue_id', 'reason', 'session_id', 'status', 'updated_at', 'verdict',
    ]);
    for (const column of ['agent_id', 'notify', 'last_result', 'notified_at']) {
      assert.ok(columnsOf('schedules').includes(column), `schedules.${column}`);
    }
  });
});

test('an older database keeps its schedules and gains the new columns and tables; migrating again is safe', async () => {
  await withDatabase((databasePath) => {
    const seed = new Database(databasePath);
    seed.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_login DATETIME);
      CREATE TABLE schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'prompt', project_path TEXT, prompt TEXT NOT NULL DEFAULT '', pipeline_id INTEGER,
        hour INTEGER NOT NULL, minute INTEGER NOT NULL, weekdays TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
        os_label TEXT, last_run_at DATETIME, last_status TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    `);
    seed.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dima', 'x');
    seed.prepare('INSERT INTO schedules (user_id, name, prompt, hour, minute) VALUES (1, ?, ?, 8, 30)').run('Бриф', 'Собери бриф');
    seed.close();
  }, async () => {
    const row = getConnection().prepare('SELECT name, prompt, agent_id, notify, last_result, notified_at FROM schedules').get();
    assert.deepEqual({ ...(row as object) }, { name: 'Бриф', prompt: 'Собери бриф', agent_id: null, notify: 0, last_result: null, notified_at: null });
    assert.deepEqual(columnsOf('agents'), AGENT_COLUMNS);

    closeConnection();
    await initializeDatabase();
    assert.equal((getConnection().prepare('SELECT COUNT(*) AS n FROM schedules').get() as { n: number }).n, 1);
  });
});

test('agentsDb: one name per user regardless of case; rules carry versions; chats point at their agent; deleting the agent takes all of it', async () => {
  await withDatabase(null, () => {
    const dima = Number(userDb.createUser('dima', 'x').id);
    const other = Number(userDb.createUser('other', 'x').id);
    const base = { role: 'Роль', checks: '', provider: 'grok', model: 'grok-4.7', effort: null, projectPath: '/p', files: ['/p/a.md'] };

    const artist = agentsDb.create({ id: 'a1', userId: dima, name: 'Художник', ...base });
    assert.equal(artist.name, 'Художник');
    assert.deepEqual(artist.files, ['/p/a.md']);
    assert.equal(agentsDb.findByName(dima, 'художник')?.id, 'a1');
    assert.equal(agentsDb.findByName(other, 'Художник'), null);
    // The index is ASCII-case-insensitive (SQLite NOCASE); Cyrillic case is the agents module's check.
    agentsDb.create({ id: 'c1', userId: other, name: 'Critic', ...base });
    assert.throws(() => agentsDb.create({ id: 'c2', userId: other, name: 'CRITIC', ...base }), /UNIQUE/);
    agentsDb.delete('c1');
    agentsDb.create({ id: 'a3', userId: other, name: 'Художник', ...base });
    assert.deepEqual(agentsDb.listByUser(dima).map((agent) => agent.id), ['a1']);

    assert.equal(agentsDb.rulesVersion('a1'), 0);
    const first = agentsDb.addRule('a1', 'До 4 переделок', 'user');
    const second = agentsDb.addRule('a1', 'Не писать CDEK', 'agent');
    assert.equal(first.versionAdded, 1);
    assert.equal(second.versionAdded, 2);
    assert.equal(second.addedBy, 'agent');
    const removed = agentsDb.removeRule('a1', first.id);
    assert.equal(removed?.versionRemoved, 3);
    assert.equal(agentsDb.removeRule('a1', first.id), null, 'a removed rule cannot be removed twice');
    assert.equal(agentsDb.rulesVersion('a1'), 3);
    assert.deepEqual(agentsDb.listRules('a1').filter((rule) => rule.versionRemoved === null).map((rule) => rule.text), ['Не писать CDEK']);

    agentsDb.linkSession('chat-1', 'a1', dima);
    assert.deepEqual(agentsDb.agentOfSession('chat-1'), { id: 'a1', name: 'Художник', userId: dima });
    assert.equal(agentsDb.agentOfSession('chat-2'), null);
    assert.deepEqual([...agentsDb.agentNamesForSessions(['chat-1', 'chat-2'])], [['chat-1', 'Художник']]);

    agentsDb.update('a1', { name: 'Художник 2', files: [] });
    assert.equal(agentsDb.get('a1')?.name, 'Художник 2');
    assert.deepEqual(agentsDb.get('a1')?.files, []);

    assert.equal(agentsDb.delete('a1'), true);
    assert.equal(agentsDb.get('a1'), null);
    assert.equal(agentsDb.listRules('a1').length, 0);
    assert.equal(agentsDb.agentOfSession('chat-1'), null);
  });
});

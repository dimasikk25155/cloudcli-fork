/**
 * «Агенты»: the agents table, their versioned memory (agent_rules) and the
 * chats that belong to an agent (agent_sessions). Validation, ownership and
 * access checks live in the agents module.
 */

import { getConnection } from '@/modules/database/connection.js';

export type AgentRow = {
  id: string;
  userId: number;
  name: string;
  role: string;
  checks: string;
  provider: string;
  model: string;
  effort: string | null;
  projectPath: string;
  files: string[];
  createdAt: string;
  updatedAt: string;
};

export type AgentInsert = Omit<AgentRow, 'createdAt' | 'updatedAt'>;
export type AgentPatch = Partial<Omit<AgentRow, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

export type AgentRuleRow = {
  id: number;
  agentId: string;
  text: string;
  addedBy: 'user' | 'agent';
  createdAt: string;
  removedAt: string | null;
  versionAdded: number;
  versionRemoved: number | null;
};

export type AgentOfSession = { id: string; name: string; userId: number };

type StoredAgent = {
  id: string;
  user_id: number;
  name: string;
  role: string;
  checks: string;
  provider: string;
  model: string;
  effort: string | null;
  project_path: string;
  files: string;
  created_at: string;
  updated_at: string;
};

type StoredRule = {
  id: number;
  agent_id: string;
  text: string;
  added_by: string;
  created_at: string;
  removed_at: string | null;
  version_added: number;
  version_removed: number | null;
};

const AGENT_COLUMNS = 'id, user_id, name, role, checks, provider, model, effort, project_path, files, created_at, updated_at';
const RULE_COLUMNS = 'id, agent_id, text, added_by, created_at, removed_at, version_added, version_removed';

function parseFiles(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function toAgent(row: StoredAgent): AgentRow {
  return {
    id: row.id,
    userId: Number(row.user_id),
    name: row.name,
    role: row.role,
    checks: row.checks ?? '',
    provider: row.provider,
    model: row.model,
    effort: row.effort ?? null,
    projectPath: row.project_path,
    files: parseFiles(row.files),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRule(row: StoredRule): AgentRuleRow {
  return {
    id: Number(row.id),
    agentId: row.agent_id,
    text: row.text,
    addedBy: row.added_by === 'agent' ? 'agent' : 'user',
    createdAt: row.created_at,
    removedAt: row.removed_at ?? null,
    versionAdded: Number(row.version_added),
    versionRemoved: row.version_removed === null ? null : Number(row.version_removed),
  };
}

function rulesVersion(agentId: string): number {
  const row = getConnection()
    .prepare('SELECT MAX(MAX(version_added), COALESCE(MAX(version_removed), 0)) AS version FROM agent_rules WHERE agent_id = ?')
    .get(agentId) as { version: number | null } | undefined;
  return Number(row?.version ?? 0);
}

export const agentsDb = {
  create(input: AgentInsert): AgentRow {
    const stamp = new Date().toISOString();
    getConnection()
      .prepare(
        `INSERT INTO agents (${AGENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.userId,
        input.name,
        input.role,
        input.checks ?? '',
        input.provider,
        input.model,
        input.effort ?? null,
        input.projectPath,
        JSON.stringify(input.files ?? []),
        stamp,
        stamp,
      );
    return { ...input, checks: input.checks ?? '', effort: input.effort ?? null, files: [...(input.files ?? [])], createdAt: stamp, updatedAt: stamp };
  },

  get(id: string): AgentRow | null {
    const row = getConnection().prepare(`SELECT ${AGENT_COLUMNS} FROM agents WHERE id = ?`).get(id) as StoredAgent | undefined;
    return row ? toAgent(row) : null;
  },

  listByUser(userId: number): AgentRow[] {
    const rows = getConnection()
      .prepare(`SELECT ${AGENT_COLUMNS} FROM agents WHERE user_id = ? ORDER BY name COLLATE NOCASE, created_at`)
      .all(userId) as StoredAgent[];
    return rows.map(toAgent);
  },

  /** Case-insensitive (SQLite NOCASE: ASCII; Cyrillic is matched by the agents module). */
  findByName(userId: number, name: string): AgentRow | null {
    const row = getConnection()
      .prepare(`SELECT ${AGENT_COLUMNS} FROM agents WHERE user_id = ? AND name = ? COLLATE NOCASE`)
      .get(userId, name) as StoredAgent | undefined;
    if (row) return toAgent(row);
    const wanted = name.toLocaleLowerCase('ru');
    return this.listByUser(userId).find((agent) => agent.name.toLocaleLowerCase('ru') === wanted) ?? null;
  },

  update(id: string, patch: AgentPatch): AgentRow | null {
    const current = this.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    getConnection()
      .prepare(
        `UPDATE agents SET name = ?, role = ?, checks = ?, provider = ?, model = ?, effort = ?, project_path = ?, files = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(next.name, next.role, next.checks, next.provider, next.model, next.effort ?? null, next.projectPath, JSON.stringify(next.files), next.updatedAt, id);
    return next;
  },

  delete(id: string): boolean {
    const db = getConnection();
    return db.transaction(() => {
      // Explicit as well as by foreign key: connections without PRAGMA foreign_keys still clean up.
      db.prepare('DELETE FROM agent_rules WHERE agent_id = ?').run(id);
      db.prepare('DELETE FROM agent_sessions WHERE agent_id = ?').run(id);
      return db.prepare('DELETE FROM agents WHERE id = ?').run(id).changes > 0;
    })();
  },

  // --- memory ---------------------------------------------------------------

  /** Every rule ever added (removed ones carry versionRemoved), oldest first. */
  listRules(agentId: string): AgentRuleRow[] {
    const rows = getConnection()
      .prepare(`SELECT ${RULE_COLUMNS} FROM agent_rules WHERE agent_id = ? ORDER BY id`)
      .all(agentId) as StoredRule[];
    return rows.map(toRule);
  },

  rulesVersion,

  liveRuleCount(agentId: string): number {
    const row = getConnection()
      .prepare('SELECT COUNT(*) AS n FROM agent_rules WHERE agent_id = ? AND version_removed IS NULL')
      .get(agentId) as { n: number };
    return Number(row.n);
  },

  /** Adds a rule as the next version. */
  addRule(agentId: string, text: string, addedBy: 'user' | 'agent'): AgentRuleRow {
    const db = getConnection();
    return db.transaction(() => {
      const version = rulesVersion(agentId) + 1;
      const stamp = new Date().toISOString();
      const result = db
        .prepare('INSERT INTO agent_rules (agent_id, text, added_by, created_at, version_added) VALUES (?, ?, ?, ?, ?)')
        .run(agentId, text, addedBy, stamp, version);
      return {
        id: Number(result.lastInsertRowid),
        agentId,
        text,
        addedBy,
        createdAt: stamp,
        removedAt: null,
        versionAdded: version,
        versionRemoved: null,
      };
    })();
  },

  /** Removes a live rule as the next version; null when there is no such live rule. */
  removeRule(agentId: string, ruleId: number): AgentRuleRow | null {
    const db = getConnection();
    return db.transaction(() => {
      const row = db
        .prepare(`SELECT ${RULE_COLUMNS} FROM agent_rules WHERE id = ? AND agent_id = ? AND version_removed IS NULL`)
        .get(ruleId, agentId) as StoredRule | undefined;
      if (!row) return null;
      const version = rulesVersion(agentId) + 1;
      const stamp = new Date().toISOString();
      db.prepare('UPDATE agent_rules SET removed_at = ?, version_removed = ? WHERE id = ?').run(stamp, version, ruleId);
      return toRule({ ...row, removed_at: stamp, version_removed: version });
    })();
  },

  // --- chats ----------------------------------------------------------------

  linkSession(sessionId: string, agentId: string, userId: number): void {
    getConnection()
      .prepare(
        `INSERT INTO agent_sessions (session_id, agent_id, user_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET agent_id = excluded.agent_id, user_id = excluded.user_id`,
      )
      .run(sessionId, agentId, userId, new Date().toISOString());
  },

  unlinkSession(sessionId: string): void {
    getConnection().prepare('DELETE FROM agent_sessions WHERE session_id = ?').run(sessionId);
  },

  agentOfSession(sessionId: string): AgentOfSession | null {
    const row = getConnection()
      .prepare(
        `SELECT a.id AS id, a.name AS name, a.user_id AS user_id
         FROM agent_sessions s JOIN agents a ON a.id = s.agent_id
         WHERE s.session_id = ?`,
      )
      .get(sessionId) as { id: string; name: string; user_id: number } | undefined;
    return row ? { id: row.id, name: row.name, userId: Number(row.user_id) } : null;
  },

  /** Sidebar: agent name per chat, only for chats that have an agent. */
  agentNamesForSessions(sessionIds: readonly string[]): Map<string, string> {
    const names = new Map<string, string>();
    const ids = [...new Set(sessionIds.filter((id) => typeof id === 'string' && id))];
    const db = getConnection();
    for (let start = 0; start < ids.length; start += 500) {
      const chunk = ids.slice(start, start + 500);
      const rows = db
        .prepare(
          `SELECT s.session_id AS session_id, a.name AS name
           FROM agent_sessions s JOIN agents a ON a.id = s.agent_id
           WHERE s.session_id IN (${chunk.map(() => '?').join(', ')})`,
        )
        .all(...chunk) as Array<{ session_id: string; name: string }>;
      for (const row of rows) names.set(row.session_id, row.name);
    }
    return names;
  },
};

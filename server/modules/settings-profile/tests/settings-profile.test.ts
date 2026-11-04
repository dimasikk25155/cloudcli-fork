import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { createIsModOn } from '@/shared/mods.js';

import { createSettingsProfileService } from '../settings-profile.service.js';

const ALLOWED = new Set(['theme', 'uiScale', 'modGroups', 'showThinking']);

function fixture(options: { modOff?: boolean } = {}) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_records(id TEXT PRIMARY KEY,kind TEXT,owner_user_id INTEGER,project_id TEXT,revision INTEGER,payload TEXT,created_at TEXT,updated_at TEXT)');
  const prefs: Record<number, Record<string, string | number | boolean>> = { 1: { theme: 'ember', uiScale: 100 }, 2: {} };
  const frames: number[] = [];
  const service = createSettingsProfileService({
    store: createWorkspaceStore(db),
    prefs: {
      get: (userId) => ({ ...prefs[userId] }),
      update: (userId, partial) => { Object.assign(prefs[userId], partial); },
      remove: (userId, keys) => { for (const key of keys) delete prefs[userId][key]; },
    },
    isAllowedKey: (key) => ALLOWED.has(key),
    notify: (userId) => frames.push(userId),
    isModOn: createIsModOn(() => (options.modOff ? { modDiagnostics: false } : {})),
  });
  return { service, prefs, frames, db };
}

test('settings.propose stores a suggestion only: nothing changes, foreign keys are dropped', () => {
  const { service, prefs, frames } = fixture();
  const proposal = service.propose(1, 'chat-1', { changes: { theme: 'glass', apiToken: 'x', uiScale: { nested: 1 }, showThinking: false }, reason: 'Светлее' });
  assert.deepEqual(proposal.preview.changes.map((change) => change.key).sort(), ['showThinking', 'theme']);
  assert.deepEqual(proposal.preview.dropped.sort(), ['apiToken', 'uiScale']);
  assert.equal(proposal.status, 'pending');
  assert.deepEqual(prefs[1], { theme: 'ember', uiScale: 100 });
  assert.deepEqual(frames, []);
  assert.throws(() => service.propose(1, null, { changes: { apiToken: 'x' } }), (error: { statusCode?: number }) => error.statusCode === 400);
});

test('apply takes a snapshot first; restore brings back values and unsets keys that were never set', () => {
  const { service, prefs, frames } = fixture();
  const proposal = service.propose(1, 'chat-1', { changes: { theme: 'glass', showThinking: true }, reason: '' });
  const snapshot = service.apply(1, { proposalId: proposal.id });
  assert.deepEqual(prefs[1], { theme: 'glass', uiScale: 100, showThinking: true });
  assert.deepEqual(snapshot.changes.find((change) => change.key === 'theme'), { key: 'theme', from: 'ember', to: 'glass' });
  assert.equal(service.overview(1).proposals[0].status, 'applied');
  assert.throws(() => service.apply(1, { proposalId: proposal.id }), (error: { statusCode?: number }) => error.statusCode === 409);

  prefs[1].uiScale = 120; // a later edit of an untouched key must survive the restore
  service.restore(1, snapshot.id);
  assert.deepEqual(prefs[1], { theme: 'ember', uiScale: 120 });
  assert.deepEqual(frames, [1, 1]);
  assert.throws(() => service.restore(1, snapshot.id), (error: { statusCode?: number }) => error.statusCode === 409);
});

test("another user's proposal or snapshot is not found; ad-hoc apply drops unknown keys", () => {
  const { service, prefs } = fixture();
  const proposal = service.propose(1, null, { changes: { theme: 'glass' } });
  assert.throws(() => service.apply(2, { proposalId: proposal.id }), (error: { statusCode?: number }) => error.statusCode === 404);
  const snapshot = service.apply(1, { changes: { theme: 'codex', evil: true } });
  assert.deepEqual(prefs[1].theme, 'codex');
  assert.equal('evil' in prefs[1], false);
  assert.throws(() => service.restore(2, snapshot.id), (error: { statusCode?: number }) => error.statusCode === 404);
});

test('with the mod off every call is 409 MOD_OFF', () => {
  const { service } = fixture({ modOff: true });
  assert.throws(() => service.propose(1, null, { changes: { theme: 'glass' } }), (error: { statusCode?: number }) => error.statusCode === 409);
  assert.throws(() => service.apply(1, { changes: { theme: 'glass' } }), (error: { statusCode?: number }) => error.statusCode === 409);
});

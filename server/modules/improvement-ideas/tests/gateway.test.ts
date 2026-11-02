import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeDatabase, closeConnection, projectsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { createIdeaRunControl, chatRunRegistry  } from '@/modules/websocket/index.js';
import { rememberRunOptions, clearRunOptions } from '@/modules/auto-relay/index.js';

test('approval gateway preserves model/effort/permissions and refuses busy, plan and non-admin', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neo3-ideas-gateway-'));
  closeConnection(); process.env.DATABASE_PATH = path.join(root, 'auth.db');
  await initializeDatabase();
  const admin = Number(userDb.createUserWithRole('idea-owner', 'x', 'admin').id);
  const guest = Number(userDb.createUserWithRole('idea-guest', 'x', 'user').id);
  projectsDb.createProjectPath(root);
  sessionsDb.createAppSession('idea-gateway', 'codex', root);
  const spawns: Array<{ content: string; options: Record<string, unknown> }> = [];
  const control = createIdeaRunControl({
    userJailFor: () => null,
    spawnFns: { codex: async (content: string, options: Record<string, unknown>) => {
      spawns.push({ content, options }); await new Promise(() => {});
    } },
    abortFns: {}, resolveToolApproval: () => {}, getPendingApprovalsForSession: () => [],
    isModOn: () => true,
  } as unknown as Parameters<typeof createIdeaRunControl>[0]);
  try {
    assert.equal(control.start({ sessionId: 'idea-gateway', userId: guest, content: 'Go' }), false);
    rememberRunOptions('idea-gateway', { permissionMode: 'plan', model: 'gpt-6-astra', effort: 'high' });
    assert.throws(() => control.start({ sessionId: 'idea-gateway', userId: admin, content: 'Go' }), /планирование/);
    rememberRunOptions('idea-gateway', { permissionMode: 'planBypass', workMode: 'autopilot', model: 'gpt-6-astra', effort: 'high' });
    assert.equal(control.start({ sessionId: 'idea-gateway', userId: admin, content: 'Approved exact idea' }), true);
    assert.equal(control.start({ sessionId: 'idea-gateway', userId: admin, content: 'Again' }), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].content, 'Approved exact idea');
    assert.equal(spawns[0].options.model, 'gpt-6-astra');
    assert.equal(spawns[0].options.effort, 'high');
    assert.equal(spawns[0].options.permissionMode, 'planBypass');
  } finally { clearRunOptions(); chatRunRegistry.clearAll(); closeConnection(); await rm(root, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

import { CodexSessionsProvider } from '../list/codex/codex-sessions.provider.js';

test('multi-file Codex patches preserve adds, deletes, moves and original diff after reload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-patch-history-'));
  const previous = process.env.DATABASE_PATH;
  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  try {
    await writeFile(process.env.DATABASE_PATH, '');
    await initializeDatabase();
    const transcript = path.join(root, 'rollout.jsonl');
    const patch = '*** Begin Patch\n*** Add File: new.txt\n+new\n*** Update File: old.txt\n*** Move to: renamed.txt\n@@\n-old\n+changed\n*** Delete File: removed.txt\n*** End Patch';
    await writeFile(transcript, JSON.stringify({ type: 'response_item', timestamp: '2026-11-02T00:00:00Z', payload: {
      type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch-call', input: patch,
    } }) + '\n');
    const session = sessionsDb.createSession('patch-fixture', 'codex', root, undefined, undefined, undefined, transcript);
    const [tool] = (await new CodexSessionsProvider().fetchHistory(session)).messages;
    assert.equal(tool.toolName, 'FileChanges');
    assert.equal(tool.toolId, 'patch-call');
    const input = tool.toolInput as { patch: string; changes: unknown[] };
    assert.equal(input.patch, patch);
    assert.deepEqual(input.changes, [
      { kind: 'add', path: 'new.txt' },
      { kind: 'update', path: 'old.txt', moveTo: 'renamed.txt' },
      { kind: 'delete', path: 'removed.txt' },
    ]);
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});

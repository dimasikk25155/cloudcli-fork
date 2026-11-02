import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

import { searchConversations } from '../services/session-conversations-search.service.js';

test('Codex search follows visible user content and excludes injected instructions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-search-'));
  const previous = process.env.DATABASE_PATH;
  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  try {
    await writeFile(process.env.DATABASE_PATH, '');
    await initializeDatabase();
    const file = path.join(root, 'fixture.jsonl');
    await writeFile(file, [
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'INJECTEDNEEDLE instructions' },
        { type: 'input_text', text: 'VISIBLENEEDLE user task' },
      ], internal_chat_message_metadata_passthrough: { content_item_kinds: ['agents_md.instructions', 'user.text'] } } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'LEGACYNEEDLE old task' } },
    ].map(row => JSON.stringify(row)).join('\n'));
    sessionsDb.createSession('codex-search-fixture', 'codex', root, 'Fixture', undefined, undefined, file);
    assert.equal((await searchConversations('INJECTEDNEEDLE')).totalMatches, 0);
    assert.equal((await searchConversations('VISIBLENEEDLE')).totalMatches, 1);
    assert.equal((await searchConversations('LEGACYNEEDLE')).totalMatches, 1);
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});

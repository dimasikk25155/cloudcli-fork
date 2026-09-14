import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore.js';

import { normalizedToChatMessages } from './useChatMessages.js';

const citation = '<oai-mem-citation>\n<citation_entries>\nMEMORY.md:115-117|note=[private context]\n</citation_entries>\n<rollout_ids>secret-id</rollout_ids>\n</oai-mem-citation>';
const row = (content: string, kind: 'text' | 'stream_delta' = 'text', role: 'user' | 'assistant' = 'assistant'): NormalizedMessage => ({
  id: 'test', sessionId: 'test', provider: 'codex', timestamp: '2026-09-14T07:20:52.531Z', kind, role, content,
});

test('assistant history and stream hide the entire memory citation, including every unfinished prefix', () => {
  assert.equal(normalizedToChatMessages([row('Ответ.\n' + citation)])[0]?.content, 'Ответ.');
  for (let length = 5; length <= citation.length; length++) {
    const messages = normalizedToChatMessages([row('Ответ.\n' + citation.slice(0, length), 'stream_delta')]);
    assert.equal(messages[0]?.content, 'Ответ.', `prefix ${length}`);
  }
  assert.equal(normalizedToChatMessages([row(citation)]).length, 0);
  assert.equal(normalizedToChatMessages([row('Ответ.\n' + citation.replace(/</g, '&lt;').replace(/>/g, '&gt;'))])[0]?.content, 'Ответ.');
});

test('citation filtering preserves ordinary MEMORY.md references, user input, and code examples', () => {
  for (const content of ['Файл MEMORY.md:115 содержит заметку.', '`<oai-mem-citation>`', '```xml\n' + citation + '\n```']) {
    assert.equal(normalizedToChatMessages([row(content)])[0]?.content, content);
  }
  assert.equal(normalizedToChatMessages([row(citation, 'text', 'user')])[0]?.content, citation);
});

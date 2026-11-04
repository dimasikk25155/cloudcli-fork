import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

// Newer Claude Code CLIs write a copy of the API request next to the real turn
// (`api-request-blob`, role user/system, no timestamp). Seen live 04.11 in an
// isolated Neo3 run: the copy showed up as a second user bubble stamped «now».
test('history: an api-request-blob copy of the request is not a chat message', () => {
  const provider = new ClaudeSessionsProvider();
  const userCopy = provider.normalizeMessage({
    type: 'api-request-blob',
    sessionId: 's1',
    hash: 'abc',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>context</system-reminder>' },
        { type: 'text', text: 'Сколько будет 17*23?' },
      ],
    },
  }, 's1');
  const systemCopy = provider.normalizeMessage({
    type: 'api-request-blob',
    sessionId: 's1',
    hash: 'def',
    message: { role: 'system', content: [{ type: 'text', text: '# Environment' }] },
  }, 's1');
  assert.deepEqual(userCopy, []);
  assert.deepEqual(systemCopy, []);

  const realTurn = provider.normalizeMessage({
    type: 'user',
    uuid: 'u1',
    timestamp: '2026-11-04T11:11:48.181Z',
    message: { role: 'user', content: [{ type: 'text', text: 'Сколько будет 17*23?' }] },
  }, 's1');
  assert.equal(realTurn.length, 1);
  assert.equal(realTurn[0].role, 'user');
});

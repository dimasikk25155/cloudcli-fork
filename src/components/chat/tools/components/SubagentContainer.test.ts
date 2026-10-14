import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { NormalizedMessage } from '../../../../stores/useSessionStore.js';
import { normalizedToChatMessages } from '../../hooks/useChatMessages.js';

import { SubagentView } from './SubagentContainer';

// A Grok helper as the server emits it (`spawn_subagent` call + its result,
// see server/modules/providers/tests/grok-subagents.test.ts), rendered with
// «Крабики-помощники» on and off.
const grok = { sessionId: 's', provider: 'grok' as const, timestamp: '2026-10-14T09:00:00.000Z' };
const rows: NormalizedMessage[] = [
  { ...grok, id: 'g1', kind: 'tool_use', toolName: 'spawn_subagent', toolId: 'g1', toolInput: { prompt: 'Count .ts files in src', description: 'Считает файлы TS' } },
  { ...grok, id: 'g1_result', kind: 'tool_result', toolId: 'g1', content: 'Subagent started in the background.\nsubagent_id: 019a1b2c-3d4e-7f00-8a1b-2c3d4e5f6a7b' },
];

function renderHelper(crabs: boolean): string {
  const message = normalizedToChatMessages(rows).find((row) => row.isSubagentContainer);
  assert.ok(message?.subagentState, 'a Grok spawn_subagent call is a subagent row');
  return renderToStaticMarkup(React.createElement(SubagentView, {
    crabs,
    toolInput: message.toolInput,
    toolId: message.toolId,
    toolResult: null,
    subagentState: message.subagentState,
    isRunActive: true,
  }));
}

test('Grok helper with «Крабики-помощники» on is a crab', () => {
  const html = renderHelper(true);
  assert.match(html, /data-crab-row="running"/);
  assert.doesNotMatch(html, /Subagent \//);
});

test('Grok helper with «Крабики-помощники» off is the plain subagent card', () => {
  const html = renderHelper(false);
  assert.doesNotMatch(html, /data-crab-row/);
  assert.match(html, /Subagent \/ Agent: Считает файлы TS/);
});

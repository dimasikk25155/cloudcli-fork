import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTitle, titleFacts } from '../list/codex/codex-session-title.js';

test('title ignores hooks and assistant report, uses user intent', async () => {
  const facts = titleFacts([
    { type: 'event_msg', payload: { type: 'user_message', message: '<hook_prompt>write memory</hook_prompt>' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'почини лаги в кодексе' } },
    { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'Обновил заметку в Obsidian' } },
  ].map(r => JSON.stringify(r)).join('\n'));
  assert.deepEqual(facts.prompts, ['почини лаги в кодексе']);
  const result = await resolveTitle(facts, 'Обновил заметку в Obsidian', null, async () => 'Codex: лаги и статусы');
  assert.equal(result?.title, 'Codex: лаги и статусы');
});
test('manual name survives, auto name refreshes only after six turns or compaction', async () => {
  const state = { title: 'Настройка Codex', turns: 1, compactions: 0 };
  let calls = 0;
  const generate = async () => { calls++; return 'Codex: названия чатов'; };
  const facts = { prompts: ['настрой кодекс'], compactions: 0, legacy: [] };
  assert.equal(await resolveTitle(facts, 'Моё название', state, generate), null);
  assert.deepEqual(await resolveTitle(facts, state.title, state, generate), state);
  assert.equal(calls, 0);
  assert.equal((await resolveTitle({ ...facts, compactions: 1 }, state.title, state, generate))?.title, 'Codex: названия чатов');
  await resolveTitle({ ...facts, prompts: Array(7).fill('новая задача') }, state.title, state, generate);
  assert.equal(calls, 2);
});
test('model outage retains a useful short user title', async () => {
  const result = await resolveTitle({ prompts: ['Почини оплату картой'], compactions: 0, legacy: [] }, null, null, async () => null);
  assert.equal(result?.title, 'Почини оплату картой');
});

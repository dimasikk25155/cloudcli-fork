import assert from 'node:assert/strict';
import test from 'node:test';

import { guardOwnAnswers } from './ownAnswers.js';
import { runSecretGuard, type SecretGuardChoice } from './secretGuard.js';

// «Свой ответ» in the question panel is text that goes to the agent, so it
// must pass the same secret guard as the composer.

const KEY = 'sk-ant-api03-FakeFakeFakeFakeFakeFakeFake0000';

function guardChoosing(choice: SecretGuardChoice, asked: string[][] = []) {
  return (text: string) =>
    runSecretGuard(text, {
      isAdmin: false,
      ask: async (prompt) => {
        asked.push(prompt.items.map((item) => item.label));
        return choice;
      },
      stash: async () => {
        throw new Error('not used');
      },
    });
}

test('a key typed as an own answer is caught before the answer leaves the panel', async () => {
  const asked: string[][] = [];
  const result = await guardOwnAnswers(
    new Map([[0, `вот ключ ${KEY}`], [1, 'Вечером']]),
    guardChoosing({ action: 'redact', names: [''] }, asked),
  );

  assert.equal(asked.length, 1, 'the dialog was shown once, for the answer with the key');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(!result.texts.get(0)!.includes(KEY), result.texts.get(0));
  assert.equal(result.texts.get(1), 'Вечером');
});

test('cancelling the guard sends nothing', async () => {
  const result = await guardOwnAnswers(new Map([[0, KEY]]), guardChoosing({ action: 'cancel' }));
  assert.equal(result.ok, false);
});

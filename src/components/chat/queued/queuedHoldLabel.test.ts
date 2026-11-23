import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { queuedHoldLabel, type QueueTranslate } from './queuedHoldLabel.js';

// The real Russian strings of the shipped locale: the test reads them from the
// json, so a missing key or a wrong text fails here and not on Dima's screen.
const ru = JSON.parse(readFileSync(new URL('../../../i18n/locales/ru/chat.json', import.meta.url), 'utf8'));
const tRu: QueueTranslate = (key, fallback) => {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ru);
  return typeof value === 'string' ? value : `MISSING:${key}|${fallback}`;
};

test('every hold reason says in Russian why the message is not going out by itself', () => {
  assert.equal(queuedHoldLabel('question', null, tRu), 'Агент ждёт твоего ответа');
  assert.equal(queuedHoldLabel('stopped', null, tRu), 'Прогон остановлен');
  assert.equal(queuedHoldLabel('failed', null, tRu), 'Прогон завершился ошибкой');
  assert.equal(queuedHoldLabel('restart', null, tRu), 'Сервер перезапускался');
});

test('an error shows the server text; without it, a generic line', () => {
  assert.equal(queuedHoldLabel('error', 'Нет доступа к проекту', tRu), 'Нет доступа к проекту');
  assert.equal(queuedHoldLabel('error', null, tRu), 'Не удалось отправить');
  assert.equal(queuedHoldLabel('error', '   ', tRu), 'Не удалось отправить');
});

test('a message that is not held has no hold line', () => {
  assert.equal(queuedHoldLabel(null, null, tRu), null);
});

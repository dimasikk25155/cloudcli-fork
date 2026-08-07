import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TELEGRAM_MESSAGE_LIMIT,
  escapeHtml,
  splitForTelegram,
} from '@/modules/telegram/telegram.service.js';

test('escapeHtml neutralizes the characters Telegram reads as HTML markup', () => {
  assert.equal(
    escapeHtml('<script>alert("1" & 2)</script>'),
    '&lt;script&gt;alert(&quot;1&quot; &amp; 2)&lt;/script&gt;'
  );
});

test('splitForTelegram keeps short text in a single message', () => {
  const chunks = splitForTelegram('короткий ответ');

  assert.deepEqual(chunks, ['короткий ответ']);
});

test('splitForTelegram cuts a long answer into chunks that all fit the limit', () => {
  const line = 'строка ответа агента, достаточно длинная чтобы набрать объём';
  const longAnswer = Array.from({ length: 400 }, (_, index) => `${index}: ${line}`).join('\n');
  assert.ok(longAnswer.length > TELEGRAM_MESSAGE_LIMIT * 3, 'fixture must exceed several messages');

  const chunks = splitForTelegram(longAnswer);

  assert.ok(chunks.length > 3, `expected several chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(
      escapeHtml(chunk).length <= TELEGRAM_MESSAGE_LIMIT,
      `chunk of ${escapeHtml(chunk).length} escaped characters exceeds the limit`
    );
  }
  // Nothing may be lost or duplicated on the way through the splitter.
  assert.equal(chunks.join('\n'), longAnswer);
});

test('splitForTelegram hard-splits a single line that is longer than one message', () => {
  const wall = 'я'.repeat(TELEGRAM_MESSAGE_LIMIT * 2 + 17);

  const chunks = splitForTelegram(wall);

  assert.equal(chunks.length, 3);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= TELEGRAM_MESSAGE_LIMIT);
  }
  assert.equal(chunks.join(''), wall);
});

test('splitForTelegram measures escaped length so no chunk breaks an HTML entity', () => {
  // Every character grows to "&amp;" (5 chars) once escaped, so a raw-length
  // splitter would happily produce chunks Telegram rejects.
  const ampersands = '&'.repeat(2000);

  const chunks = splitForTelegram(ampersands);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    const escaped = escapeHtml(chunk);
    assert.ok(escaped.length <= TELEGRAM_MESSAGE_LIMIT);
    assert.ok(!/&(?!amp;)/.test(escaped), 'chunk ends mid-entity');
  }
  assert.equal(chunks.join(''), ampersands);
});

test('splitForTelegram returns nothing for empty text', () => {
  assert.deepEqual(splitForTelegram(''), []);
});

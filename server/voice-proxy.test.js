import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HALLUCINATION_RE,
  dropHallucinatedEdges,
  cleanTranscript,
  glossaryPrompt,
  buildCorrectionSystemPrompt,
} from './voice-proxy.js';

test('HALLUCINATION_RE matches YouTube outro artifacts (incl. Cyrillic suffixes)', () => {
  assert.ok(HALLUCINATION_RE.test('Спасибо за просмотр.'));
  assert.ok(HALLUCINATION_RE.test('Подписывайтесь на канал!'));
  assert.ok(HALLUCINATION_RE.test('Ставьте лайки')); // \w port must span Cyrillic
  assert.ok(!HALLUCINATION_RE.test('Разверни проект на Vercel.'));
});

test('cleanTranscript collapses consecutive duplicate sentences', () => {
  const out = cleanTranscript('Привет мир. Привет мир. Как дела?');
  assert.equal(out, 'Привет мир. Как дела?');
});

test('cleanTranscript strips a hallucinated outro from the tail', () => {
  const out = cleanTranscript('Сделай деплой на прод. Спасибо за просмотр.');
  assert.equal(out, 'Сделай деплой на прод.');
});

test('cleanTranscript reduces whole-junk text to empty', () => {
  assert.equal(cleanTranscript('Спасибо за просмотр.'), '');
});

test('dropHallucinatedEdges trims high-no_speech trailing segments', () => {
  const segments = [
    { text: 'Настоящая речь про API.', no_speech_prob: 0.01 },
    { text: 'Спасибо за просмотр.', no_speech_prob: 0.02 },
    { text: ' ', no_speech_prob: 0.9 },
  ];
  const { kept, cut } = dropHallucinatedEdges(segments);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].text, 'Настоящая речь про API.');
  assert.equal(cut.length, 2);
});

test('glossaryPrompt lists canon terms and is empty without a dictionary', () => {
  assert.equal(glossaryPrompt({}), '');
  const p = glossaryPrompt({ 'Claude Code': ['клод код'], Vercel: [] });
  assert.match(p, /Claude Code/);
  assert.match(p, /Vercel/);
});

test('buildCorrectionSystemPrompt embeds the glossary mapping', () => {
  const p = buildCorrectionSystemPrompt({ 'Claude Code': ['клод код', 'клауд код'] }, true);
  assert.match(p, /клод код → Claude Code/);
  assert.match(p, /клауд код → Claude Code/);
});

test('buildCorrectionSystemPrompt includes the filler rule only when enabled', () => {
  assert.match(buildCorrectionSystemPrompt({}, true), /слова-паразиты/);
  assert.doesNotMatch(buildCorrectionSystemPrompt({}, false), /слова-паразиты/);
});

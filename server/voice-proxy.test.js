import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HALLUCINATION_RE,
  dropHallucinatedEdges,
  cleanTranscript,
  glossaryPrompt,
  buildCorrectionSystemPrompt,
  parseGlossary,
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

test('buildCorrectionSystemPrompt adds the keep-words rule only when given some', () => {
  const p = buildCorrectionSystemPrompt({}, true, ['чё', 'нету']);
  assert.match(p, /Слова ниже автор говорит сам/);
  assert.match(p, /чё, нету/);
  assert.doesNotMatch(buildCorrectionSystemPrompt({}, true), /Слова ниже автор говорит сам/);
});

test('parseGlossary reads the NeoWhisper YAML dialect', () => {
  const yaml = [
    '# comment',
    'slang:',
    '  закоммитить: [за комитить, закомитить]',
    'keep:',
    '  - чё',
    '  - нету',
    'terms:',
    '  Claude Code: [клод код, клауд код]',
    '  Next.js: [некст джиэс]',
  ].join('\n');
  const { dictionary, keep } = parseGlossary(yaml, false);
  assert.deepEqual(dictionary['Claude Code'], ['клод код', 'клауд код']);
  assert.deepEqual(dictionary['Next.js'], ['некст джиэс']);
  assert.deepEqual(dictionary.закоммитить, ['за комитить', 'закомитить']);
  assert.deepEqual(keep, ['чё', 'нету']);
});

test('parseGlossary reads JSON, flat map or { dictionary, keep }', () => {
  assert.deepEqual(parseGlossary('{"Vercel":["версель"]}', true).dictionary, { Vercel: ['версель'] });
  const wrapped = parseGlossary('{"dictionary":{"Groq":["грок"]},"keep":["блин"]}', true);
  assert.deepEqual(wrapped.dictionary, { Groq: ['грок'] });
  assert.deepEqual(wrapped.keep, ['блин']);
});

test('glossaryPrompt prefers the terms list and stays inside the prompt cap', () => {
  const dict = { сленг: ['слэнг'] };
  assert.match(glossaryPrompt(dict, ['Claude Code', 'Vercel']), /Claude Code, Vercel/);
  assert.doesNotMatch(glossaryPrompt(dict, ['Vercel']), /сленг/);
  const many = Array.from({ length: 300 }, (_, i) => `Термин${i}`);
  const capped = glossaryPrompt({}, many);
  assert.ok(capped.length < 600, `prompt too long: ${capped.length}`);
  assert.doesNotMatch(capped, /Термин\d+$/); // never ends mid-term
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { transcriptLooksLossy } from '../shared/voiceTranscript.js';
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

test('cleanTranscript preserves intentionally repeated sentences', () => {
  const out = cleanTranscript('Привет мир. Привет мир. Как дела?');
  assert.equal(out, 'Привет мир. Привет мир. Как дела?');
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

test('real speech is not deleted because Whisper assigns high silence probability', () => {
  const segments = [
    { text: 'Первая половина про Claude.', no_speech_prob: 0.01 },
    { text: 'Вторая половина про API и деплой.', no_speech_prob: 0.92 },
  ];
  assert.deepEqual(dropHallucinatedEdges(segments).kept, segments);
});

test('cleanup keeps meaningful sentences resembling video intros', () => {
  assert.equal(cleanTranscript('В этом видео нужно исправить звук.'), 'В этом видео нужно исправить звук.');
});

test('DimaTorzok credit attached to real text removes only the credit', () => {
  assert.equal(cleanTranscript('Субтитры сделал DimaTorzok Привет, проверь API.'), 'Привет, проверь API.');
  assert.equal(cleanTranscript('Первая часть. Субтитры сделал DimaTorzok. Вторая часть.'), 'Первая часть. Вторая часть.');
  assert.equal(cleanTranscript('Удали фразу «Субтитры сделал DimaTorzok» из результата.'), 'Удали фразу «Субтитры сделал DimaTorzok» из результата.');
});

test('the credit is cut anywhere, in any spelling, without touching real talk about subtitles', () => {
  assert.equal(cleanTranscript('dimatozok Субтитры делал DimaTorzok Вот ты, почини Виспер.'), 'Вот ты, почини Виспер.');
  assert.equal(cleanTranscript('Заморосим жёстко. Субтитры делал DimaTorzok Снимать как есть.'), 'Заморосим жёстко. Снимать как есть.');
  assert.equal(cleanTranscript('Субтитры создавал Дима Торзок. Ваши субтитры созданы по-русски. Привет.'), 'Привет.');
  assert.equal(cleanTranscript('Как сделать субтитры на видео?'), 'Как сделать субтитры на видео?');
});

test('a transcript far too short for the speech it came from is flagged', () => {
  assert.equal(transcriptLooksLossy('Привет.', 30), true);
  assert.equal(transcriptLooksLossy('Вот ты, почини Виспер.', 8, true), true);
  assert.equal(transcriptLooksLossy(Array(40).fill('слово').join(' '), 30), false);
  assert.equal(transcriptLooksLossy('Ага.', 2), false); // short takes are never second-guessed
});

test('glossary retains terms with no aliases and terms with inline comments', () => {
  const parsed = parseGlossary('terms:\n  API: []\n  Claude: [клауд] # canonical\n', false);
  assert.deepEqual(parsed.terms, ['API', 'Claude']);
});

// --- Which voice backend a request goes to --------------------------------
import { resolveConfig, DEFAULT_VOICE_BASE_URL } from './voice-proxy.js';

const bareEnv = { baseUrl: '', apiKey: '', hasKeyPool: false, sttModel: 'whisper-1', sttModelSet: false, ttsModel: 'tts-1', ttsVoice: 'alloy' };

test('a fresh server with no key has no voice backend: the mic stays hidden', () => {
  assert.equal(resolveConfig({ headers: {} }, bareEnv).baseUrl, '');
});

test('a key typed in Settings -> Voice is enough: it goes to Groq with a Groq model', () => {
  const cfg = resolveConfig({ headers: { 'x-voice-api-key': 'gsk_user' } }, bareEnv);
  assert.equal(cfg.baseUrl, DEFAULT_VOICE_BASE_URL);
  assert.equal(cfg.apiKey, 'gsk_user');
  assert.equal(cfg.sttModel, 'whisper-large-v3');
});

test('a server key without VOICE_API_BASE_URL also means Groq', () => {
  assert.equal(resolveConfig({ headers: {} }, { ...bareEnv, apiKey: 'gsk_server' }).baseUrl, DEFAULT_VOICE_BASE_URL);
  assert.equal(resolveConfig({ headers: {} }, { ...bareEnv, hasKeyPool: true }).baseUrl, DEFAULT_VOICE_BASE_URL);
});

test('an explicit server backend is kept, with its own model and even without a key', () => {
  const env = { ...bareEnv, baseUrl: 'http://127.0.0.1:9000/v1' };
  const cfg = resolveConfig({ headers: { 'x-voice-api-key': 'gsk_user' } }, env);
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:9000/v1');
  assert.equal(cfg.sttModel, 'whisper-1');
  assert.equal(resolveConfig({ headers: {} }, env).baseUrl, 'http://127.0.0.1:9000/v1');
});

test('the STT model from env or the user wins over the Groq default', () => {
  const env = { ...bareEnv, apiKey: 'k', sttModel: 'whisper-large-v3-turbo', sttModelSet: true };
  assert.equal(resolveConfig({ headers: {} }, env).sttModel, 'whisper-large-v3-turbo');
  assert.equal(resolveConfig({ headers: { 'x-voice-stt-model': 'm' } }, { ...bareEnv, apiKey: 'k' }).sttModel, 'm');
});

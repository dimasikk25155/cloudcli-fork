import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import express from 'express';
import { splitWav, voicedSeconds } from '../shared/voiceAudio.js';
import { correctionPreservesContent, joinTranscripts } from '../shared/voiceTranscript.js';

function wav(seconds, rate = 16000) {
  const audio = Buffer.alloc(44 + seconds * rate * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVE', 8);
  audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22); audio.writeUInt32LE(rate, 24); audio.writeUInt32LE(rate * 2, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  for (let n = 0; n < seconds * rate; n++) audio.writeInt16LE(1000 + n % 20000, 44 + n * 2);
  return audio;
}

test('two-minute WAV retains every sample, in order, with bounded overlap', () => {
  const original = wav(120);
  const { chunks, duration } = splitWav(original);
  assert.equal(duration, 120);
  assert.ok(chunks.length >= 2);
  let covered = 0;
  for (const chunk of chunks) {
    assert.ok(chunk.end - chunk.start <= 60);
    assert.ok(chunk.start <= covered);
    assert.ok(covered - chunk.start <= 0.601);
    const actual = Buffer.from(chunk.audio).subarray(44);
    assert.deepEqual(actual, original.subarray(44 + Math.round(chunk.start * 32000), 44 + Math.round(chunk.end * 32000)));
    covered = chunk.end;
  }
  assert.equal(covered, 120);
});

test('short WAV, malformed WAV and foreign containers are explicit', () => {
  assert.equal(splitWav(wav(5)).chunks.length, 1);
  assert.throws(() => splitWav(wav(5).subarray(0, -2)), /Неполный WAV/);
  assert.equal(splitWav(Buffer.from('not a WAV container')), null);
});

test('overlap stitching preserves beginning and ending without repeated boundary words', () => {
  assert.equal(joinTranscripts(['Первая часть про Claude Code', 'Claude Code и API. Последняя фраза.']),
    'Первая часть про Claude Code и API. Последняя фраза.');
});

test('corrector rejects half, middle omissions, lost ending and empty output', () => {
  const words = Array.from({ length: 100 }, (_, i) => `слово${i}`);
  const raw = words.join(' ');
  assert.equal(correctionPreservesContent(raw, words.slice(0, 55).join(' ')), false);
  assert.equal(correctionPreservesContent(raw, [...words.slice(0, 40), ...words.slice(60)].join(' ')), false);
  assert.equal(correctionPreservesContent(raw, words.slice(0, 97).join(' ')), false);
  assert.equal(correctionPreservesContent(raw, [...words.slice(0, 50), ...words.slice(51)].join(' ')), false);
  assert.equal(correctionPreservesContent(raw, ''), false);
  assert.equal(correctionPreservesContent(raw, raw + '.'), true);
});

test('corrector accepts dictionary changes but preserves slang and RU/EN words', () => {
  const dictionary = { 'Claude Code': ['клауд код'], API: ['эй пи ай'] };
  assert.equal(correctionPreservesContent('Чё за хуйня, клауд код сломал эй пи ай', 'Чё за хуйня, Claude Code сломал API.', dictionary), true);
  assert.equal(correctionPreservesContent('Чё за хуйня, клауд код сломал эй пи ай', 'Claude Code сломал API.', dictionary), false);
});

test('HTTP proxy returns all chunks, rejects failed/empty chunks and protects raw from correction', async (t) => {
  process.env.VOICE_DICTIONARY_PATH = '';
  process.env.VOICE_API_BASE_URL = 'https://voice-fixture.invalid/v1';
  process.env.VOICE_API_KEY = 'test-only';
  process.env.VOICE_CORRECTION_MODEL = 'fixture-corrector';
  const { default: router } = await import('./voice-proxy.js?integration');
  const app = express();
  app.use('/voice', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let mode = 'ok';
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://voice-fixture.invalid')) return realFetch(url, options);
    if (String(url).endsWith('/chat/completions')) {
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Первая часть.' } }] });
    }
    calls++;
    assert.equal(options.body.get('response_format'), 'verbose_json');
    const audio = options.body.get('file');
    assert.ok(splitWav(new Uint8Array(await audio.arrayBuffer())).duration <= 60);
    if (mode === 'failed' && calls === 2) return new Response('bad chunk', { status: 400 });
    if (mode === 'empty' && calls >= 2) return Response.json({ text: 'Субтитры сделал DimaTorzok' });
    const texts = ['Первая часть про Claude Code.', 'Середина про API и сленг.', 'Последняя контрольная фраза.'];
    return Response.json({ text: texts[calls - 1], segments: [{ text: texts[calls - 1], no_speech_prob: 0.99 }] });
  };
  const submit = () => {
    const form = new FormData();
    // A steady hum: no speech to judge, so each chunk is recognised exactly once.
    const hum = wav(120);
    for (let at = 44; at < hum.length; at += 2) hum.writeInt16LE(1000, at);
    form.append('audio', new Blob([hum], { type: 'audio/wav' }), 'recording.wav');
    return realFetch(`http://127.0.0.1:${server.address().port}/voice/transcribe`, { method: 'POST', body: form });
  };
  const response = await submit();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.audioSeconds, 120);
  assert.equal(result.chunks, 3);
  assert.match(result.text, /Первая часть.*Середина.*Последняя/);
  assert.equal(result.text, result.raw);
  calls = 0; mode = 'failed';
  assert.equal((await submit()).status, 400);
  calls = 0; mode = 'empty';
  const empty = await submit();
  assert.equal(empty.status, 422);
  assert.match((await empty.json()).error, /часть 2/);
});

// Speech-like take: 0.5 s loud, 0.5 s near-silent, repeated.
function speechWav(seconds, rate = 16000) {
  const audio = wav(seconds, rate);
  for (let n = 0; n < seconds * rate; n++) {
    const loud = Math.floor(n / (rate / 2)) % 2 === 0;
    audio.writeInt16LE(loud ? Math.round(4000 * Math.sin(n / 7)) : (n % 3) - 1, 44 + n * 2);
  }
  return audio;
}

test('voiced seconds count speech, not the whole take or a constant hum', () => {
  const voiced = voicedSeconds(new Uint8Array(speechWav(20)));
  assert.ok(voiced > 8 && voiced < 12, `voiced=${voiced}`);
});

test('speech swapped for the YouTube credit is re-recognised; a still-short result is marked suspect', async (t) => {
  process.env.VOICE_DICTIONARY_PATH = '';
  process.env.VOICE_API_BASE_URL = 'https://voice-fixture.invalid/v1';
  process.env.VOICE_API_KEY = 'test-only';
  process.env.VOICE_CORRECTION_MODEL = '';
  const { default: router } = await import('./voice-proxy.js?ladder');
  const app = express();
  app.use('/voice', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let healed = true;
  const sent = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://voice-fixture.invalid')) return realFetch(url, options);
    sent.push({ prompt: options.body.get('prompt') });
    if (sent.length === 1 || !healed) return Response.json({ text: 'Субтитры делал DimaTorzok' + (healed ? '' : ' Привет.') });
    return Response.json({ text: Array(30).fill('слово').join(' ') });
  };
  const submit = (options = {}) => {
    const form = new FormData();
    form.append('audio', new Blob([speechWav(30)], { type: 'audio/wav' }), 'recording.wav');
    form.append('options', JSON.stringify(options));
    return realFetch(`http://127.0.0.1:${server.address().port}/voice/transcribe`, { method: 'POST', body: form });
  };
  const ok = await (await submit()).json();
  assert.equal(ok.suspect, false);
  assert.equal(ok.text.split(' ').length, 30);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].prompt, null); // the second recipe drops the glossary hint
  healed = false; sent.length = 0;
  const short = await (await submit()).json();
  assert.equal(short.suspect, true);
  assert.match(short.text, /^Привет\./);
  assert.ok(sent.length >= 3, `tried ${sent.length} recipes`);
});

test('corrector may swap a spoken word for its Latin name, never drop speech', () => {
  assert.equal(correctionPreservesContent('напиши код на питоне который парсит авито', 'Напиши код на Python, который парсит Авито.'), true);
  assert.equal(correctionPreservesContent('ну короче рекламу запускать в телеге', 'Рекламу запускать в Telegram.', {}, true), true);
  assert.equal(correctionPreservesContent('раз два три четыре пять шесть', 'Раз, два, три.'), false);
  assert.equal(correctionPreservesContent('рекламу запускать в телеге типа так', 'Рекламу запускать в Telegram.', {}, true), false);
});

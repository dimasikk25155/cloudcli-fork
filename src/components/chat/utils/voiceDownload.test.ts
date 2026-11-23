import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deliverVoiceFile,
  isAppleMobile,
  needsPortableCopy,
  prepareVoiceFile,
  voiceFileName,
  type VoiceDeliveryDeps,
} from './voiceDownload';

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15', platform: 'iPhone', maxTouchPoints: 5 };
const IPAD_AS_MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 };

test('iPhone and an iPad posing as a Mac count as Apple mobile; a real Mac does not', () => {
  assert.equal(isAppleMobile(IPHONE), true);
  assert.equal(isAppleMobile(IPAD_AS_MAC), true);
  assert.equal(isAppleMobile(MAC), false);
});

test('only WebM and Ogg need a playable copy', () => {
  assert.equal(needsPortableCopy('audio/webm;codecs=opus'), true);
  assert.equal(needsPortableCopy('audio/ogg'), true);
  assert.equal(needsPortableCopy('audio/mp4'), false);
});

test('file name carries the recording time and the extension', () => {
  assert.equal(voiceFileName(new Date(2026, 10, 23, 3, 14).getTime(), 'wav'), 'golos-2026-11-23-0314.wav');
});

const createdAt = new Date(2026, 10, 23, 3, 14).getTime();

test('a WebM recording is handed out as WAV', async () => {
  const blob = new Blob([new Uint8Array(100)], { type: 'audio/webm;codecs=opus' });
  const file = await prepareVoiceFile({ blob, filename: 'recording.webm', createdAt },
    async () => new Blob([new Uint8Array(200)], { type: 'audio/wav' }));
  assert.equal(file.name, 'golos-2026-11-23-0314.wav');
  assert.equal(file.type, 'audio/wav');
  assert.equal(file.size, 200);
});

test('an undecodable recording is still handed out in its original form', async () => {
  const blob = new Blob([new Uint8Array(100)], { type: 'audio/webm' });
  for (const toWav of [async () => null, async () => { throw new Error('decode'); }]) {
    const file = await prepareVoiceFile({ blob, filename: 'recording.webm', createdAt }, toWav);
    assert.equal(file.name, 'golos-2026-11-23-0314.webm');
    assert.equal(file.size, 100);
  }
});

test('an m4a recording is not re-encoded', async () => {
  const blob = new Blob([new Uint8Array(100)], { type: 'audio/mp4' });
  let called = false;
  const file = await prepareVoiceFile({ blob, filename: 'recording.m4a', createdAt }, async () => { called = true; return null; });
  assert.equal(called, false);
  assert.equal(file.name, 'golos-2026-11-23-0314.m4a');
});

function deps(over: Partial<VoiceDeliveryDeps>, log: string[]): VoiceDeliveryDeps {
  return {
    env: IPHONE,
    canShare: () => true,
    share: async () => { log.push('share'); },
    saveByLink: () => { log.push('link'); },
    ...over,
  };
}

const file = new File([new Uint8Array(10)], 'golos.wav', { type: 'audio/wav' });

test('iPhone gets the share sheet, called synchronously inside the tap', () => {
  const log: string[] = [];
  void deliverVoiceFile(file, deps({}, log));
  assert.deepEqual(log, ['share']);
});

test('a cancelled share sheet does not fall back to the link', async () => {
  const log: string[] = [];
  const result = await deliverVoiceFile(file, deps({ share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }, log));
  assert.equal(result, 'cancelled');
  assert.deepEqual(log, []);
});

test('a refused share (expired tap) falls back to the link', async () => {
  const log: string[] = [];
  const result = await deliverVoiceFile(file, deps({ share: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } }, log));
  assert.equal(result, 'link');
  assert.deepEqual(log, ['link']);
});

test('desktop and browsers without file sharing use the link', async () => {
  const log: string[] = [];
  assert.equal(await deliverVoiceFile(file, deps({ env: MAC }, log)), 'link');
  assert.equal(await deliverVoiceFile(file, deps({ canShare: () => false }, log)), 'link');
  assert.equal(await deliverVoiceFile(file, deps({ share: undefined }, log)), 'link');
  assert.deepEqual(log, ['link', 'link', 'link']);
});

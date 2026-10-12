// Browser-only regression fixture. Bundle with esbuild (import.meta.env = {})
// and serve from an isolated loopback origin; never load in the production app.
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useVoiceInput } from '../src/components/chat/hooks/useVoiceInput';
import { listVoiceRecordings, saveVoiceRecording, removeVoiceRecording, voiceRecoveryScope } from '../src/lib/voiceRecovery';

const scope = voiceRecoveryScope('fixture-user', 'fixture-project', 'fixture-chat');
const otherScope = voiceRecoveryScope('another-user', 'fixture-project', 'fixture-chat');
let hook: ReturnType<typeof useVoiceInput>;
let root: Root;
let network: 'blocked' | 'ok' = 'blocked';
let calls = 0;
const transcripts: { text: string; send?: boolean }[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, message: string) {
  const end = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function wav() {
  const bytes = new Uint8Array(44 + 16000 * 2 * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  for (let n = 44; n < bytes.length; n += 2) view.setInt16(n, Math.round(Math.sin(n / 15) * 3000), true);
  return new Blob([bytes], { type: 'audio/wav' });
}

class FixtureRecorder {
  static instance: FixtureRecorder;
  static isTypeSupported() { return true; }
  state = 'inactive';
  mimeType = 'audio/wav';
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  constructor() { FixtureRecorder.instance = this; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  }
}

Object.defineProperty(window, 'MediaRecorder', { value: FixtureRecorder });
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => new MediaStream() });
window.fetch = async (_url, init) => {
  calls++;
  const saved = await listVoiceRecordings(scope);
  assert(saved.length > 0, 'A network request ran before the audio backup committed');
  const audio = (init?.body as FormData).get('audio') as Blob;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await audio.arrayBuffer()))].join(',');
  if (network === 'blocked') {
    localStorage.setItem('fixture-upload-hash', hash);
    return Response.json({ error: 'Groq отклонил VPN-соединение (403)' }, { status: 502 });
  }
  assert(hash === localStorage.getItem('fixture-upload-hash'), 'Retry uploaded different audio');
  return Response.json({ text: 'Сохрани всю мысль от начала до конца.' });
};

function Harness() {
  hook = useVoiceInput((text, send) => transcripts.push({ text, send }), () => {}, scope);
  return <div>{hook.state}: {hook.recoveryMessage}</div>;
}

function mount() {
  root = createRoot(document.getElementById('root')!);
  root.render(<Harness />);
}

async function firstPass() {
  await until(() => hook?.state === 'idle', 'Recovery did not initialize');
  hook.toggle();
  await until(() => hook.state === 'recording', 'Recording did not start');
  const audio = wav();
  FixtureRecorder.instance.ondataavailable?.({ data: audio });
  hook.stop({ send: true });
  await until(() => hook.state === 'error', 'VPN failure did not become recoverable');
  const saved = await listVoiceRecordings(scope);
  assert(saved.length === 1 && saved[0].status === 'pending', 'Original missing after VPN failure');
  assert(saved[0].blob.size === audio.size, 'Original audio was truncated in storage');
  assert(transcripts.length === 0, 'Failure delivered a partial transcript');
  assert(calls === 3, 'Expected bounded retry attempts');
  localStorage.setItem('fixture-recording-id', saved[0].id);
  await saveVoiceRecording({ ...saved[0], id: 'fixture-other-user', scope: otherScope });
  assert((await listVoiceRecordings(scope)).length === 1, 'Recovery mixed accounts');
  return { passed: ['backup-before-upload', 'vpn-failure-retained', 'bounded-retries', 'account-isolation'], id: saved[0].id };
}

async function afterReload() {
  await until(() => hook?.state === 'error', 'Reload did not restore the recording');
  assert((await listVoiceRecordings(scope))[0].id === localStorage.getItem('fixture-recording-id'), 'Wrong original restored');
  network = 'ok';
  hook.retry(); hook.retry();
  await until(() => hook.state === 'idle', 'Restored retry did not complete');
  assert(calls === 1, 'Double click sent duplicate requests');
  assert(transcripts.length === 1 && transcripts[0].send === false, 'Restored recording auto-sent or duplicated');
  assert((await listVoiceRecordings(scope)).length === 0, 'Acknowledged recording was not removed');
  assert((await listVoiceRecordings(otherScope)).length === 1, 'Success deleted another account backup');
  return { passed: ['reload-restores-original', 'identical-audio-after-vpn-change', 'no-double-submit', 'no-delayed-auto-send', 'scoped-cleanup'] };
}

async function readyResult() {
  const before = calls;
  await saveVoiceRecording({ id: 'fixture-ready', scope, createdAt: Date.now(), blob: wav(), filename: 'ready.wav',
    recordedMs: 2000, status: 'ready', transcript: 'Уже распознанная мысль без сети.' });
  root.unmount();
  mount();
  await until(() => hook.state === 'error', 'Ready transcript not restored');
  hook.retry();
  await until(() => hook.state === 'idle', 'Ready transcript not delivered');
  assert(calls === before, 'Ready transcript unnecessarily contacted the network');
  assert(transcripts.at(-1)?.text === 'Уже распознанная мысль без сети.', 'Ready text lost');
  await removeVoiceRecording('fixture-other-user');
  return { passed: ['ready-text-restored-offline'] };
}

async function storageFailure() {
  const put = IDBObjectStore.prototype.put;
  const createUrl = URL.createObjectURL;
  const click = HTMLAnchorElement.prototype.click;
  let downloaded: Blob | undefined;
  IDBObjectStore.prototype.put = () => { throw new DOMException('Disk full', 'QuotaExceededError'); };
  URL.createObjectURL = (blob) => { downloaded = blob as Blob; return createUrl(blob); };
  HTMLAnchorElement.prototype.click = () => {};
  try {
    network = 'blocked';
    hook.toggle();
    await until(() => hook.state === 'recording', 'Storage failure blocked microphone start');
    FixtureRecorder.instance.ondataavailable?.({ data: wav() });
    hook.stop();
    await until(() => hook.state === 'error', 'Storage/network failure was not recoverable');
    assert(hook.recoveryMessage?.includes('недоступно'), 'UI falsely claimed durable storage');
    hook.download();
    assert(downloaded?.size === wav().size, 'In-memory original could not be downloaded');
  } finally {
    IDBObjectStore.prototype.put = put;
    URL.createObjectURL = createUrl;
    HTMLAnchorElement.prototype.click = click;
  }
  network = 'ok';
  hook.retry();
  await until(() => hook.state === 'idle', 'Original lost after disk storage recovered');
  return { passed: ['quota-error-visible', 'download-without-storage', 'retry-after-storage-recovery'] };
}

mount();
Object.assign(window, { voiceRecoveryChecks: { firstPass, afterReload, readyResult, storageFailure } });

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeDrop,
  extractDropUrls,
  hasUsableFiles,
  resolveDroppedFiles,
  type DropSnapshot,
} from './dropTransfer.js';

const transfer = (data: Record<string, string>) => ({
  getData: (type: string) => data[type] ?? '',
});

const snapshot = (overrides: Partial<DropSnapshot> = {}): DropSnapshot => ({
  types: [],
  files: [],
  urls: [],
  ...overrides,
});

test('urls are read from uri-list, moz-url, html and plain text, deduped', () => {
  const urls = extractDropUrls(transfer({
    'text/uri-list': '# comment\nhttps://cdn.example/a.png\n',
    'text/x-moz-url': 'https://cdn.example/a.png\nКартинка\nhttps://cdn.example/b.jpg\nВторая',
    'text/html': '<p><img alt="x" src="https://cdn.example/c.webp?x=1&amp;y=2"></p>',
    'text/plain': 'file:///Users/me/Downloads/shot.png',
  }));
  assert.deepEqual(urls, [
    'https://cdn.example/a.png',
    'https://cdn.example/b.jpg',
    'https://cdn.example/c.webp?x=1&y=2',
    'file:///Users/me/Downloads/shot.png',
  ]);
});

test('plain caption text is not mistaken for a url', () => {
  assert.deepEqual(extractDropUrls(transfer({ 'text/plain': 'просто подпись' })), []);
});

test('a real file is left to react-dropzone', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
  assert.equal(hasUsableFiles(snapshot({ types: ['Files'], files: [file] })), true);
  assert.equal(hasUsableFiles(snapshot({ types: ['Files'], files: [new File([], 'empty.png')] })), false);
});

test('an image link is fetched into an attachment', async () => {
  const fetchImpl = (async () => new Response(new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }))) as typeof fetch;
  const result = await resolveDroppedFiles(
    snapshot({ types: ['text/uri-list'], urls: ['https://cdn.example/photo.jpg'] }),
    fetchImpl,
  );
  assert.equal(result.reason, null);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, 'photo.jpg');
  assert.equal(result.files[0].type, 'image/jpeg');
});

test('a data: image gets a generated name with the right extension', async () => {
  const fetchImpl = (async () => new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }))) as typeof fetch;
  const result = await resolveDroppedFiles(snapshot({ urls: ['data:image/png;base64,AQ=='] }), fetchImpl);
  assert.match(result.files[0].name, /^dropped-\d+-1\.png$/);
});

test('an unusable drop is explained instead of ignored', async () => {
  const fetchImpl = (async () => { throw new Error('cors'); }) as typeof fetch;
  const onlyLocal = await resolveDroppedFiles(
    snapshot({ types: ['text/uri-list', 'text/plain'], urls: ['file:///tmp/a.png'] }),
    fetchImpl,
  );
  assert.equal(onlyLocal.files.length, 0);
  assert.match(onlyLocal.reason ?? '', /путь к файлу на диске/);
  assert.match(onlyLocal.reason ?? '', /text\/uri-list, text\/plain/);

  const blocked = await resolveDroppedFiles(snapshot({ types: ['Files'], files: [new File([], 'x.png')] }), fetchImpl);
  assert.equal(blocked.files.length, 0);
  assert.match(blocked.reason ?? '', /не передал саму картинку/);
});

test('describeDrop names an empty transfer', () => {
  assert.match(describeDrop(snapshot()), /нет данных/);
});

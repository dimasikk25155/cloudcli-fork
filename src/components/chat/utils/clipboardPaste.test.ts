import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectPastedFiles,
  isRedundantPastedText,
  isRepeatPaste,
  pasteSignature,
  REPEAT_PASTE_WINDOW_MS,
} from './clipboardPaste.js';

const makeFile = (name: string, size = 1024, type = 'image/jpeg', lastModified = 1) =>
  ({ name, size, type, lastModified }) as unknown as File;

interface ItemSpec {
  kind: 'file' | 'string';
  type?: string;
  file?: File;
}

/** Minimal DataTransfer stand-in: `items` mixes string and file entries. */
const makeClipboard = ({ items = [], files = [] }: { items?: ItemSpec[]; files?: File[] }) =>
  ({
    items: items.map((entry) => ({
      kind: entry.kind,
      type: entry.type ?? (entry.kind === 'file' ? '' : 'text/plain'),
      getAsFile: () => (entry.kind === 'file' ? (entry.file ?? null) : null),
    })),
    files,
  }) as unknown as DataTransfer;

const photo = makeFile('telegram-cloud-photo-size-2-1234.jpg');
const telegramPath =
  '/Users/dima/Library/Group Containers/6N38VWS5BX.ru.keepcoder.Telegram/appstore/account-1/postbox/media/telegram-cloud-photo-size-2-1234.jpg';

test('Safari: the file comes back even though a text item is present too', () => {
  const clipboard = makeClipboard({
    items: [{ kind: 'string' }, { kind: 'file', type: '', file: photo }],
  });
  assert.deepEqual(collectPastedFiles(clipboard), [photo]);
});

test('a file listed in both items and files is attached once', () => {
  const clipboard = makeClipboard({
    items: [{ kind: 'file', type: 'image/jpeg', file: photo }],
    files: [photo],
  });
  assert.deepEqual(collectPastedFiles(clipboard), [photo]);
});

test('Electron: the same screenshot with two read timestamps attaches once', () => {
  // Measured on Electron 38 (the desktop app): one paste event, `getAsFile()`
  // and `clipboard.files` returning the same 642993-byte PNG stamped 2 ms apart.
  const clipboard = makeClipboard({
    items: [{ kind: 'file', type: 'image/png', file: makeFile('image.png', 642993, 'image/png', 1787221012544) }],
    files: [makeFile('image.png', 642993, 'image/png', 1787221012542)],
  });
  assert.equal(collectPastedFiles(clipboard).length, 1);
});

test('two different screenshots pasted at once both attach', () => {
  const clipboard = makeClipboard({
    items: [
      { kind: 'file', type: 'image/png', file: makeFile('image.png', 81893, 'image/png') },
      { kind: 'file', type: 'image/png', file: makeFile('image.png', 796340, 'image/png') },
    ],
  });
  assert.equal(collectPastedFiles(clipboard).length, 2);
});

test('the same clipboard delivered twice in a blink is one paste', () => {
  const signature = pasteSignature([photo]);
  assert.equal(isRepeatPaste(signature, { signature, at: 1000 }, 1000 + REPEAT_PASTE_WINDOW_MS - 1), true);
});

test('the same picture attached again later is a real second paste', () => {
  const signature = pasteSignature([photo]);
  assert.equal(isRepeatPaste(signature, { signature, at: 1000 }, 1000 + REPEAT_PASTE_WINDOW_MS), false);
});

test('a different picture right after the first one is never swallowed', () => {
  const first = pasteSignature([photo]);
  const second = pasteSignature([makeFile('other.jpg', 2048)]);
  assert.equal(isRepeatPaste(second, { signature: first, at: 1000 }, 1001), false);
});

test('the first paste of a session has nothing to repeat', () => {
  assert.equal(isRepeatPaste(pasteSignature([photo]), null, 1000), false);
});

test('Safari fallback: files without any items still attach', () => {
  const clipboard = makeClipboard({ items: [], files: [photo] });
  assert.deepEqual(collectPastedFiles(clipboard), [photo]);
});

test('plain text paste attaches nothing', () => {
  const clipboard = makeClipboard({ items: [{ kind: 'string' }] });
  assert.deepEqual(collectPastedFiles(clipboard), []);
});

test('the Telegram cache path is dropped once the image is attached', () => {
  assert.equal(isRedundantPastedText(telegramPath, [photo]), true);
});

test('a file:// URL is dropped too', () => {
  assert.equal(isRedundantPastedText('file:///Users/dima/Desktop/shot.png', [photo]), true);
});

test('a bare file name matching the attachment is dropped', () => {
  assert.equal(isRedundantPastedText('telegram-cloud-photo-size-2-1234.jpg', [photo]), true);
});

test('an empty text flavour is dropped', () => {
  assert.equal(isRedundantPastedText('   ', [photo]), true);
});

test('a caption pasted alongside an image is kept', () => {
  assert.equal(isRedundantPastedText('посмотри на этот скрин', [photo]), false);
});

test('a web link pasted alongside an image is kept', () => {
  assert.equal(isRedundantPastedText('https://example.com/photo.jpg', [photo]), false);
});

test('multi-line text is kept even if it starts with a path', () => {
  assert.equal(isRedundantPastedText(`${telegramPath}\nsecond line`, [photo]), false);
});

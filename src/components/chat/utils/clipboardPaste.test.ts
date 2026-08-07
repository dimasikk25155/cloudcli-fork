import assert from 'node:assert/strict';
import test from 'node:test';

import { collectPastedFiles, isRedundantPastedText } from './clipboardPaste.js';

const makeFile = (name: string, size = 1024, type = 'image/jpeg') =>
  ({ name, size, type, lastModified: 1 }) as unknown as File;

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

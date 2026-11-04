import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPOSER_DRAFT_EVENT, composerDraftImages, sendToComposer, type ComposerDraftDetail } from './composerDraft';

// «Попросить агента» кладёт снимок участка в поле ввода вместе с текстом:
// sendToComposer несёт картинки, слушатель композера берёт их через composerDraftImages.

function withWindow(run: (received: ComposerDraftDetail[]) => void) {
  const target = new EventTarget();
  const received: ComposerDraftDetail[] = [];
  target.addEventListener(COMPOSER_DRAFT_EVENT, (event) => received.push((event as CustomEvent<ComposerDraftDetail>).detail));
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = target;
  try {
    run(received);
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
}

test('sendToComposer carries attached pictures with the text and autoSend', () => {
  const shot = new File([new Uint8Array([137, 80, 78, 71])], 'snapshot.png', { type: 'image/png' });
  withWindow((received) => {
    sendToComposer('Поправь заголовок', { autoSend: true, images: [shot] });
    assert.equal(received.length, 1);
    assert.equal(received[0].text, 'Поправь заголовок');
    assert.equal(received[0].autoSend, true);
    assert.deepEqual(composerDraftImages(received[0]), [shot]);
  });
});

test('composerDraftImages: no pictures, junk and empty files are dropped', () => {
  const shot = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
  const empty = new File([], 'empty.png', { type: 'image/png' });
  assert.deepEqual(composerDraftImages({ text: 'x' }), []);
  assert.deepEqual(composerDraftImages({ text: 'x', images: 'nope' as unknown as File[] }), []);
  assert.deepEqual(composerDraftImages({ text: 'x', images: [shot, empty, null as unknown as File, { size: 3 } as unknown as File] }), [shot]);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { getCommentDraft, setCommentDraft } from './artifactDrafts.js';

// R04: an unfinished comment (text and region) survives leaving the canvas tab
// and coming back; save or cancel clears it.

test('a comment draft is kept per artifact until cleared', () => {
  assert.equal(getCommentDraft('a1'), null);
  setCommentDraft('a1', { anchor: { type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, text: 'Сдвинь логотип' });
  setCommentDraft('a2', { anchor: { type: 'quote', text: 'Заголовок' }, text: '' });

  // The view unmounts and mounts again — the draft is still there.
  assert.deepEqual(getCommentDraft('a1'), { anchor: { type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, text: 'Сдвинь логотип' });
  assert.deepEqual(getCommentDraft('a2'), { anchor: { type: 'quote', text: 'Заголовок' }, text: '' });

  // Saved or cancelled — gone, the other artifact keeps its own.
  setCommentDraft('a1', null);
  assert.equal(getCommentDraft('a1'), null);
  assert.deepEqual(getCommentDraft('a2'), { anchor: { type: 'quote', text: 'Заголовок' }, text: '' });
  setCommentDraft('a2', null);
});

test('a later edit replaces the stored draft', () => {
  setCommentDraft('a3', { anchor: { type: 'quote', text: 'x' }, text: 'пер' });
  setCommentDraft('a3', { anchor: { type: 'quote', text: 'x' }, text: 'первый' });
  assert.equal(getCommentDraft('a3')?.text, 'первый');
  setCommentDraft('a3', null);
});

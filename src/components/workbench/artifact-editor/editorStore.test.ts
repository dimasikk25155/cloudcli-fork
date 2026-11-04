import assert from 'node:assert/strict';
import test from 'node:test';

import {
  anyUnsavedEdits,
  clearEditorState,
  confirmDiscardUnsaved,
  getEditorState,
  installUnsavedEditsGuard,
  setEditorState,
  subscribeEditorState,
  type EditorSession,
} from './editorStore';

// The canvas unmounts an inactive tab: the edit must outlive the component.

const state = (over: Partial<Parameters<typeof setEditorState>[1]> = {}) => ({
  baseVersionN: 3,
  ops: [{ type: 'hide' as const, id: '4', hidden: true }],
  redo: [],
  selection: ['4'],
  zoom: 1,
  snap: true,
  ...over,
});

test('state is kept per artifact id until cleared', () => {
  assert.equal(getEditorState('art-1'), null);
  setEditorState('art-1', state());
  setEditorState('art-2', state({ baseVersionN: 9 }));
  assert.equal(getEditorState('art-1')?.baseVersionN, 3);
  assert.deepEqual(getEditorState('art-1')?.selection, ['4']);
  assert.equal(getEditorState('art-2')?.baseVersionN, 9);
  clearEditorState('art-1');
  assert.equal(getEditorState('art-1'), null);
  assert.equal(getEditorState('art-2')?.baseVersionN, 9, 'other artifacts are not touched');
  clearEditorState('art-2');
});

test('subscribers hear changes of their artifact', () => {
  const heard: string[] = [];
  const stop = subscribeEditorState((artifactId) => heard.push(artifactId));
  setEditorState('art-3', state());
  clearEditorState('art-3');
  stop();
  setEditorState('art-3', state());
  clearEditorState('art-3');
  assert.deepEqual(heard, ['art-3', 'art-3']);
});

/** A session whose history says «unsaved» (the store reads only `history.dirty`). */
const session = (dirty: boolean) => ({ kind: 'html', doc: {}, history: { dirty } }) as unknown as EditorSession;

test('page reload asks while any artifact has unsaved edits — even with no editor on screen', () => {
  const page = new EventTarget();
  installUnsavedEditsGuard(page);
  installUnsavedEditsGuard(page);
  const reload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    page.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(reload(), false);
  setEditorState('art-5', state({ session: session(false) }));
  assert.equal(anyUnsavedEdits(), false, 'saved edits do not ask');
  assert.equal(reload(), false);
  setEditorState('art-5', state({ session: session(true) }));
  assert.equal(anyUnsavedEdits(), true);
  assert.equal(reload(), true, 'unsaved edits stop the reload');
  clearEditorState('art-5');
  assert.equal(reload(), false);
});

test('closing an artifact tab with unsaved edits asks first; «no» keeps the edits, «yes» drops them', () => {
  setEditorState('art-6', { ...state({ session: session(true) }), path: 'site/page.html', absPath: '/p/site/page.html' });
  const asked: string[] = [];
  const no = (text: string) => { asked.push(text); return false; };
  const yes = (text: string) => { asked.push(text); return true; };
  assert.equal(confirmDiscardUnsaved({ artifactId: 'art-6' }, no), false);
  assert.ok(getEditorState('art-6'), '«no» keeps the edits');
  assert.match(asked[0], /несохранённ/);
  // A tab opened from a file link knows only the path.
  assert.equal(confirmDiscardUnsaved({ path: '/p/site/page.html' }, no), false);
  assert.equal(confirmDiscardUnsaved({ path: 'site/page.html' }, yes), true);
  assert.equal(getEditorState('art-6'), null, '«yes» drops them');
  // Nothing unsaved — closes without asking.
  setEditorState('art-7', state({ session: session(false) }));
  assert.equal(confirmDiscardUnsaved({ artifactId: 'art-7' }, no), true);
  assert.equal(confirmDiscardUnsaved({ artifactId: 'other' }, no), true);
  assert.equal(asked.length, 3);
  clearEditorState('art-7');
});

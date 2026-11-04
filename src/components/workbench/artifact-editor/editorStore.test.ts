import assert from 'node:assert/strict';
import test from 'node:test';

import { clearEditorState, getEditorState, setEditorState, subscribeEditorState } from './editorStore';

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

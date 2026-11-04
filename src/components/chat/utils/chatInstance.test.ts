import assert from 'node:assert/strict';
import test from 'node:test';

import { draftStorageKey, isEscapeForInstance, EMBEDDED_CHAT_ROOT_SELECTOR, WORKBENCH_CANVAS_SELECTOR } from './chatInstance.js';

test('the chat on the left keeps its old per-project draft key; the chat on the canvas has its own per session', () => {
  assert.equal(draftStorageKey('p1', null), 'draft_input_p1');
  assert.equal(draftStorageKey('p1', 's-right'), 'draft_input_p1__s-right');
  assert.notEqual(draftStorageKey('p1', 's-right'), draftStorageKey('p1', 's-other'));
});

/** A fake DOM node: `contains` follows the parent chain, `closest` matches by marker. */
type FakeNode = { parent: FakeNode | null; markers: string[]; contains: (other: unknown) => boolean; closest: (selector: string) => FakeNode | null };
function node(parent: FakeNode | null, markers: string[] = []): FakeNode {
  const self: FakeNode = {
    parent,
    markers,
    contains(other) {
      let cursor = other as FakeNode | null;
      while (cursor) {
        if (cursor === self) return true;
        cursor = cursor.parent;
      }
      return false;
    },
    closest(selector) {
      let cursor: FakeNode | null = self;
      while (cursor) {
        if (cursor.markers.includes(selector)) return cursor;
        cursor = cursor.parent;
      }
      return null;
    },
  };
  return self;
}

test('double Esc stops only the chat the key was pressed in', () => {
  const body = node(null);
  const mainRoot = node(body);
  const mainTextarea = node(mainRoot);
  const canvas = node(body, [WORKBENCH_CANVAS_SELECTOR]);
  const rightRoot = node(canvas, [EMBEDDED_CHAT_ROOT_SELECTOR]);
  const rightTextarea = node(rightRoot);
  const canvasTabStrip = node(canvas);

  // Typing in the right chat: the right one handles it, the left one does not.
  assert.equal(isEscapeForInstance(rightTextarea, rightRoot, true), true);
  assert.equal(isEscapeForInstance(rightTextarea, mainRoot, false), false);

  // Typing in the left chat: only the left one.
  assert.equal(isEscapeForInstance(mainTextarea, mainRoot, false), true);
  assert.equal(isEscapeForInstance(mainTextarea, rightRoot, true), false);

  // Esc from the canvas (outside the right chat) is not the left chat's either.
  assert.equal(isEscapeForInstance(canvasTabStrip, mainRoot, false), false);
  assert.equal(isEscapeForInstance(canvasTabStrip, rightRoot, true), false);

  // Esc from nowhere in particular (body) stops the main chat, as before.
  assert.equal(isEscapeForInstance(body, mainRoot, false), true);
  assert.equal(isEscapeForInstance(body, rightRoot, true), false);
  assert.equal(isEscapeForInstance(null, mainRoot, false), true);
});

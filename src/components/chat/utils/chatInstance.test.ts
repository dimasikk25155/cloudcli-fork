import assert from 'node:assert/strict';
import test from 'node:test';

import { stageWorkspaceHandoff, HANDOFF_STORAGE_PREFIX } from '../../agent-workspace/handoff.js';

import { createPointerOwner, draftStorageKey, isEscapeForInstance, whenPageVisible, workspaceHandoffsFor, CHAT_ROOT_SELECTOR, EMBEDDED_CHAT_ROOT_SELECTOR, WORKBENCH_CANVAS_SELECTOR } from './chatInstance.js';

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
  const mainRoot = node(body, [CHAT_ROOT_SELECTOR]);
  const mainTextarea = node(mainRoot);
  const canvas = node(body, [WORKBENCH_CANVAS_SELECTOR]);
  const rightRoot = node(canvas, [CHAT_ROOT_SELECTOR, EMBEDDED_CHAT_ROOT_SELECTOR]);
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

test('a material sent to the left chat stays with it even when the right chat sends first', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  stageWorkspaceHandoff({ projectId: 'p', projectPath: '/p', source: { kind: 'document', id: 'doc' }, text: 'Material', grantId: 'grant-1' }, storage, storage);
  const bound: Array<[string, string]> = [];
  const bind = async (grantId: string, sessionId: string) => { bound.push([grantId, sessionId]); };

  // The right chat sends and cancels: nothing of the left one is touched.
  await workspaceHandoffsFor(true).bindOnSend('p', 's-right', storage, bind);
  workspaceHandoffsFor(true).cancel('p', storage);
  assert.deepEqual(bound, []);
  assert.match(values.get(HANDOFF_STORAGE_PREFIX + 'p') ?? '', /grant-1/);

  // The left chat sends: the material is bound to it.
  await workspaceHandoffsFor(false).bindOnSend('p', 's-left', storage, bind);
  assert.deepEqual(bound, [['grant-1', 's-left']]);
  assert.equal(values.has(HANDOFF_STORAGE_PREFIX + 'p'), false);
});

test('Esc on <body> belongs to the chat clicked last (its feed or its portaled menu)', () => {
  const body = node(null);
  const mainRoot = node(body, [CHAT_ROOT_SELECTOR]);
  const canvas = node(body, [WORKBENCH_CANVAS_SELECTOR]);
  const rightRoot = node(canvas, [CHAT_ROOT_SELECTOR, EMBEDDED_CHAT_ROOT_SELECTOR]);
  const portaledMenu = node(body);
  const owner = createPointerOwner();
  const main = () => ({ self: 'main', owner: owner.current() });
  const right = () => ({ self: 'right', owner: owner.current() });

  // Click on the right chat's feed: focus falls to body, Esc stops the right one.
  owner.claim('right');
  assert.equal(isEscapeForInstance(body, rightRoot, true, right()), true);
  assert.equal(isEscapeForInstance(body, mainRoot, false, main()), false);
  // Its menu was portaled to body and just closed: still the right one.
  assert.equal(isEscapeForInstance(portaledMenu, rightRoot, true, right()), true);
  assert.equal(isEscapeForInstance(portaledMenu, mainRoot, false, main()), false);

  // A click in the left chat takes it back.
  owner.claim('main');
  assert.equal(isEscapeForInstance(body, mainRoot, false, main()), true);
  assert.equal(isEscapeForInstance(body, rightRoot, true, right()), false);

  // A click outside both chats: body Esc is the main chat's, as before.
  owner.release();
  assert.equal(isEscapeForInstance(body, mainRoot, false, main()), true);
  assert.equal(isEscapeForInstance(body, rightRoot, true, right()), false);

  // Focus inside a chat still decides, whoever was clicked last.
  owner.claim('right');
  const mainTextarea = node(mainRoot);
  assert.equal(isEscapeForInstance(mainTextarea, mainRoot, false, main()), true);
  assert.equal(isEscapeForInstance(mainTextarea, rightRoot, true, right()), false);
});

test('the right chat is marked seen when the page comes back, not only when its status changes', () => {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'hidden',
    addEventListener: (_type: 'visibilitychange', listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: 'visibilitychange', listener: () => void) => { listeners.delete(listener); },
  };
  const fire = (state: string) => { doc.visibilityState = state; for (const listener of [...listeners]) listener(); };
  let seen = 0;

  const stop = whenPageVisible(doc, () => { seen += 1; });
  assert.equal(seen, 0, 'hidden page: nothing yet');
  fire('visible');
  assert.equal(seen, 1, 'page shown again: marked');
  fire('hidden');
  assert.equal(seen, 1);
  stop();
  fire('visible');
  assert.equal(seen, 1, 'after unmount: no more');

  doc.visibilityState = 'visible';
  whenPageVisible(doc, () => { seen += 1; });
  assert.equal(seen, 2, 'shown page: marked at once');
});

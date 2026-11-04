import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBridgeScript } from './bridge';
import { applyOpToDocument } from './editorModel';

// The bridge is an inline <script data-neo3-bridge> put first into the copy of
// the document. It carries applyOpToDocument and listens only to the parent
// window with the session's nonce.

const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const scriptBody = (html: string) => html.replace(/^<script data-neo3-bridge>/, '').replace(/<\/script>$/, '');

test('an inline script tag that carries applyOpToDocument and the nonce, and parses as JavaScript', () => {
  const html = buildBridgeScript(NONCE);
  assert.match(html, /^<script data-neo3-bridge>/);
  assert.match(html, /<\/script>$/);
  const body = scriptBody(html);
  assert.ok(body.includes(applyOpToDocument.toString()), 'the operation code is the same function the parent uses');
  assert.ok(body.includes(JSON.stringify(NONCE)));
  assert.doesNotMatch(body, /<\/script/i, 'nothing closes the tag early');
  assert.doesNotThrow(() => new Function(body));
});

test('a nonce that is not a plain random key is refused', () => {
  for (const bad of ['', 'short', '"};alert(1);//0123456789', 'x'.repeat(129)]) {
    assert.throws(() => buildBridgeScript(bad), bad);
  }
});

// A tiny window: enough to start the bridge and deliver messages to it.
function runBridge() {
  const posted: Array<Record<string, unknown>> = [];
  const listeners: Record<string, (event: unknown) => void> = {};
  const parentWindow = { postMessage: (message: Record<string, unknown>) => { posted.push(message); } };
  const attrs = new Map<string, string>([['data-neo3-id', '7'], ['style', 'color:red']]);
  const element = {
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    localName: 'p',
    parentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml', children: [] },
    childNodes: [],
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attrs.set(name, value); },
    removeAttribute: (name: string) => { attrs.delete(name); },
    hasAttribute: (name: string) => attrs.has(name),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
  };
  const fakeDocument = {
    readyState: 'loading',
    currentScript: null,
    documentElement: { scrollWidth: 800, scrollHeight: 600 },
    body: {},
    head: {},
    querySelectorAll: () => [element],
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[`document:${type}`] = listener; },
  };
  const fakeWindow = {
    parent: parentWindow,
    scrollX: 0,
    scrollY: 0,
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
  };
  const body = scriptBody(buildBridgeScript(NONCE));
  new Function('window', 'document', 'requestAnimationFrame', 'setTimeout', 'getComputedStyle', 'ResizeObserver', 'MutationObserver', body)(
    fakeWindow, fakeDocument, () => 0, () => 0, () => ({ display: 'block' }), undefined, undefined,
  );
  const send = (source: unknown, data: unknown) => listeners.message({ source, data });
  return { posted, attrs, parentWindow, send, listeners };
}

test('the bridge applies an operation only from the parent window with the right nonce', () => {
  const bridge = runBridge();
  const op = { type: 'style', id: '7', prop: 'color', value: 'blue' };
  bridge.send({}, { nonce: NONCE, type: 'apply', op });
  assert.equal(bridge.attrs.get('style'), 'color:red', 'another window is ignored');
  bridge.send(bridge.parentWindow, { nonce: 'f'.repeat(32), type: 'apply', op });
  assert.equal(bridge.attrs.get('style'), 'color:red', 'a foreign nonce is ignored');
  bridge.send(bridge.parentWindow, { type: 'apply', op });
  assert.equal(bridge.attrs.get('style'), 'color:red', 'no nonce is ignored');
  bridge.send(bridge.parentWindow, { nonce: NONCE, type: 'apply', op });
  assert.equal(bridge.attrs.get('style'), 'color: blue');
});

test('everything the bridge sends carries the nonce; ready reports the page size', () => {
  const bridge = runBridge();
  bridge.listeners['document:DOMContentLoaded']?.({});
  bridge.listeners.load?.({});
  bridge.send(bridge.parentWindow, { nonce: NONCE, type: 'select', ids: ['7'] });
  assert.ok(bridge.posted.length > 0);
  for (const message of bridge.posted) assert.equal(message.nonce, NONCE);
  const ready = bridge.posted.filter((message) => message.type === 'ready');
  assert.equal(ready.length, 1, 'ready is sent once');
  assert.equal(ready[0].width, 800);
  assert.equal(ready[0].height, 600);
  const rects = bridge.posted.find((message) => message.type === 'rects') as { items: Array<{ id: string; parentLayout: string }> } | undefined;
  assert.deepEqual(rects?.items.map((item) => [item.id, item.parentLayout]), [['7', 'block']]);
});

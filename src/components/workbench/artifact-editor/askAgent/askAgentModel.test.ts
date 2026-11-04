import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASK_FRAGMENT_LIMIT,
  askPollDelay,
  buildRegionAskMessage,
  buildSelectionAskMessage,
  createAskAgentStore,
  dataUrlToFile,
  detectAgentUpdate,
  regionToPixels,
  stripEditorIds,
} from './askAgentModel';

// «Попросить агента»: сообщение в исходный чат (путь, селектор, фрагмент ≤2000,
// просьба, снимок или пометка «без снимка»), опрос новой версии и её баннер.

const MIN = 60_000;

test('selection message: path, selector, fragment, request, snapshot attached', () => {
  const text = buildSelectionAskMessage({
    title: 'Лендинг',
    filePath: '/p/site/index.html',
    versionN: 3,
    items: [{ selector: 'body > header > h1', fragment: '<h1 class="t">Привет</h1>' }],
    request: 'Сделай заголовок крупнее',
    snapshot: true,
    unsavedEdits: false,
  });
  assert.match(text, /\/p\/site\/index\.html/);
  assert.match(text, /версия 3/);
  assert.match(text, /body > header > h1/);
  assert.match(text, /<h1 class="t">Привет<\/h1>/);
  assert.match(text, /Сделай заголовок крупнее/);
  assert.match(text, /Снимок участка — во вложении/);
  assert.doesNotMatch(text, /без снимка/);
});

test('selection message without a snapshot says «без снимка»; unsaved edits are mentioned', () => {
  const text = buildSelectionAskMessage({
    title: 'Лендинг', filePath: '/p/a.html', versionN: 1,
    items: [{ selector: 'div', fragment: '<div></div>' }],
    request: 'Убери', snapshot: false, unsavedEdits: true,
  });
  assert.match(text, /без снимка/);
  assert.match(text, /несохранённые правки/);
});

test('fragments together stay within 2000 characters and are marked as cut', () => {
  const long = `<p>${'Q'.repeat(5000)}</p>`;
  const text = buildSelectionAskMessage({
    title: 'T', filePath: '/p/a.html', versionN: 1,
    items: [{ selector: 'p:nth-of-type(1)', fragment: long }, { selector: 'p:nth-of-type(2)', fragment: long }],
    request: 'x', snapshot: true, unsavedEdits: false,
  });
  const letters = (text.match(/Q/g) ?? []).length;
  assert.ok(letters <= ASK_FRAGMENT_LIMIT, `fragment letters: ${letters}`);
  assert.ok(letters > 1500);
  assert.match(text, /обрезан/);
});

test('a fragment with a code fence does not break out of its block', () => {
  const text = buildSelectionAskMessage({
    title: 'T', filePath: '/p/a.html', versionN: 1,
    items: [{ selector: 'pre', fragment: '<pre>```js\nx\n```</pre>' }],
    request: 'x', snapshot: true, unsavedEdits: false,
  });
  assert.match(text, /````html\n<pre>```js\nx\n```<\/pre>\n````/);
});

test('stripEditorIds removes the editor ids only', () => {
  assert.equal(
    stripEditorIds('<div data-neo3-id="12" class="a"><span data-neo3-id="12.1">x</span></div>'),
    '<div class="a"><span>x</span></div>',
  );
});

test('region message: file, region in percent and pixels, snapshot note', () => {
  const text = buildRegionAskMessage({
    title: 'Баннер', filePath: '/p/banner.png', versionN: 2,
    region: { x: 0.1, y: 0.25, w: 0.5, h: 0.5 },
    pixels: { x: 100, y: 200, w: 500, h: 400 },
    request: 'Перекрась кнопку', snapshot: false,
  });
  assert.match(text, /\/p\/banner\.png/);
  assert.match(text, /x 100, y 200, 500×400/);
  assert.match(text, /10%/);
  assert.match(text, /Перекрась кнопку/);
  assert.match(text, /без снимка/);
});

test('regionToPixels: fractions of the picture → whole pixels inside it', () => {
  assert.deepEqual(regionToPixels({ x: 0.1, y: 0.25, w: 0.5, h: 0.5 }, { width: 1000, height: 800 }), { x: 100, y: 200, w: 500, h: 400 });
  assert.deepEqual(regionToPixels({ x: 0.9, y: 0.9, w: 0.2, h: 0.2 }, { width: 100, height: 100 }), { x: 90, y: 90, w: 10, h: 10 });
  assert.equal(regionToPixels({ x: 0, y: 0, w: 0.5, h: 0.5 }, { width: 0, height: 100 }), null);
});

test('poll: 5 s for 10 min after the ask, then 30 s while visible, none when hidden', () => {
  const askedAt = 1_000_000;
  assert.equal(askPollDelay({ askedAt, now: askedAt + 1000, visible: true }), 5000);
  assert.equal(askPollDelay({ askedAt, now: askedAt + 9 * MIN, visible: false }), 5000);
  assert.equal(askPollDelay({ askedAt, now: askedAt + 11 * MIN, visible: true }), 30_000);
  assert.equal(askPollDelay({ askedAt, now: askedAt + 11 * MIN, visible: false }), null);
  assert.equal(askPollDelay({ askedAt: null, now: askedAt, visible: true }), 30_000);
  assert.equal(askPollDelay({ askedAt: null, now: askedAt, visible: false }), null);
});

test('agent update: a newer version not written by «Правка вручную»', () => {
  const versions = [{ n: 1, source: 'publish' }, { n: 2, source: 'edit' }, { n: 3, source: 'change' }] as const;
  assert.deepEqual(detectAgentUpdate(2, { latestVersion: 3, versions: [...versions] }), { from: 2, to: 3 });
  assert.equal(detectAgentUpdate(1, { latestVersion: 2, versions: [...versions.slice(0, 2)] }), null);
  assert.equal(detectAgentUpdate(3, { latestVersion: 3, versions: [...versions] }), null);
  assert.equal(detectAgentUpdate(null, { latestVersion: 3, versions: [...versions] }), null);
});

test('store: an ask parked for another chat is taken once, by that chat and artifact', () => {
  const store = createAskAgentStore();
  const item = { text: 'x', images: [] };
  store.park('s2', 'a1', item);
  assert.equal(store.take('s1', 'a1'), null);
  assert.equal(store.take('s2', 'a2'), null);
  assert.equal(store.take('s2', 'a1'), item);
  assert.equal(store.take('s2', 'a1'), null);
  assert.equal(store.askedAt('a1'), null);
  store.markAsked('a1', 42);
  assert.equal(store.askedAt('a1'), 42);
});

test('dataUrlToFile: a PNG data URL becomes a png File; junk — null', () => {
  const file = dataUrlToFile('data:image/png;base64,iVBORw0K', 'shot.png');
  assert.ok(file instanceof File);
  assert.equal(file!.type, 'image/png');
  assert.equal(file!.name, 'shot.png');
  assert.equal(file!.size, 6);
  assert.equal(dataUrlToFile('javascript:alert(1)', 'x.png'), null);
  assert.equal(dataUrlToFile(null, 'x.png'), null);
});

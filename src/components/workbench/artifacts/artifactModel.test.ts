import assert from 'node:assert/strict';
import test from 'node:test';

import { isAutoArtifactPath, toolChangedPaths } from '../../../../shared/artifacts.js';

import {
  artifactTabForPath,
  commentStatusLabel,
  isArtifactsChangeFor,
  pendingArtifactPath,
  rectFromDrag,
  sendTarget,
  versionSourceLabel,
} from './artifactModel.js';
import { lineDiff } from './lineDiff.js';

test('a dragged rectangle becomes fractions of the frame, clamped to it; a click is not a region', () => {
  assert.deepEqual(rectFromDrag({ x: 300, y: 50 }, { x: 100, y: 150 }, { width: 400, height: 200 }), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.deepEqual(rectFromDrag({ x: 350, y: 100 }, { x: 900, y: -40 }, { width: 400, height: 200 }), { x: 0.875, y: 0, w: 0.125, h: 0.5 });
  assert.equal(rectFromDrag({ x: 10, y: 10 }, { x: 11, y: 11 }, { width: 400, height: 200 }), null);
  assert.equal(rectFromDrag({ x: 0, y: 0 }, { x: 10, y: 10 }, { width: 0, height: 0 }), null);
});

test('a file link opens a pending artifact tab by path; its ref is read back', () => {
  const tab = artifactTabForPath('/p/docs/report.html:12');
  assert.deepEqual(tab, { kind: 'artifact', ref: 'path:/p/docs/report.html', title: 'report.html' });
  assert.equal(pendingArtifactPath(tab.ref), '/p/docs/report.html');
  assert.equal(pendingArtifactPath('a1b2'), null);
  assert.equal(pendingArtifactPath(undefined), null);
});

test('comments go to the source chat: here when it is open beside the canvas, otherwise that chat must be opened', () => {
  assert.deepEqual(sendTarget({ artifactSessionId: 's1', currentSessionId: 's1' }), { kind: 'here', sessionId: 's1' });
  assert.deepEqual(sendTarget({ artifactSessionId: 's1', currentSessionId: 's2' }), { kind: 'elsewhere', sessionId: 's1' });
  assert.deepEqual(sendTarget({ artifactSessionId: null, currentSessionId: 's2' }), { kind: 'here', sessionId: 's2' });
  assert.deepEqual(sendTarget({ artifactSessionId: null, currentSessionId: null }), { kind: 'none' });
});

test('plain Russian labels for statuses and version sources', () => {
  assert.equal(commentStatusLabel('open'), 'Открыт');
  assert.equal(commentStatusLabel('sent'), 'Отправлен агенту');
  assert.equal(commentStatusLabel('resolved'), 'Учтён');
  assert.equal(versionSourceLabel({ source: 'publish' }), 'публикация');
  assert.equal(versionSourceLabel({ source: 'change' }), 'изменение файла');
  assert.equal(versionSourceLabel({ source: 'restore', restoredFrom: 2 }), 'восстановлена версия 2');
  assert.equal(versionSourceLabel({ source: 'edit' }), 'Правка вручную');
});

test('line diff marks removed and added lines and keeps the common ones', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd'), [
    { type: 'same', text: 'a' },
    { type: 'removed', text: 'b' },
    { type: 'added', text: 'B' },
    { type: 'same', text: 'c' },
    { type: 'added', text: 'd' },
  ]);
  assert.deepEqual(lineDiff('', 'x'), [{ type: 'added', text: 'x' }]);
  assert.deepEqual(lineDiff('same', 'same'), [{ type: 'same', text: 'same' }]);
});

test('artifacts_changed: only this project (and artifact, when asked); a reconnect re-reads', () => {
  const frame = { kind: 'artifacts_changed', projectId: 'p', artifactId: 'a1' };
  assert.equal(isArtifactsChangeFor(frame, 'p'), true);
  assert.equal(isArtifactsChangeFor(frame, 'other'), false);
  assert.equal(isArtifactsChangeFor(frame, 'p', 'a1'), true);
  assert.equal(isArtifactsChangeFor(frame, 'p', 'a2'), false);
  assert.equal(isArtifactsChangeFor({ kind: 'attention_changed', projectId: 'p' }, 'p'), false);
  assert.equal(isArtifactsChangeFor({ kind: 'websocket_reconnected' }, 'p', 'a1'), true);
});

test('auto «Результаты»: HTML and SVG of the project, not dot/build folders', () => {
  assert.equal(isAutoArtifactPath('index.html'), true);
  assert.equal(isAutoArtifactPath('docs/demo/deck.HTM'), true);
  assert.equal(isAutoArtifactPath('img/logo.svg'), true);
  assert.equal(isAutoArtifactPath('src/app.tsx'), false);
  assert.equal(isAutoArtifactPath('notes.md'), false);
  assert.equal(isAutoArtifactPath('.autopilot/run/dashboard.html'), false);
  assert.equal(isAutoArtifactPath('web/node_modules/x/index.html'), false);
  assert.equal(isAutoArtifactPath('dist/index.html'), false);
  assert.equal(isAutoArtifactPath('../outside.html'), false);
  assert.equal(isAutoArtifactPath(''), false);
});

test('toolChangedPaths: Claude, Codex (both shapes), Grok; other tools none', () => {
  assert.deepEqual(toolChangedPaths('Write', { file_path: '/p/a.html' }), ['/p/a.html']);
  assert.deepEqual(toolChangedPaths('FileChanges', [{ path: 'a.html' }, { path: 'b.svg', moveTo: 'c.svg' }]), ['a.html', 'b.svg', 'c.svg']);
  assert.deepEqual(toolChangedPaths('FileChanges', { changes: [{ path: 'a.html' }] }), ['a.html']);
  assert.deepEqual(toolChangedPaths('write_file', '{"path":"/p/g.html"}'), ['/p/g.html']);
  assert.deepEqual(toolChangedPaths('Bash', { command: 'echo > x.html' }), []);
  assert.deepEqual(toolChangedPaths(undefined, {}), []);
});

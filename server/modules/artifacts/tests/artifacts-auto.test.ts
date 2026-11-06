import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { createArtifactAutoPublish, createArtifactsService, type AutoPublishRun } from '@/modules/artifacts/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

// «Результаты» fill themselves: pages the agent writes in a chat become
// artifacts of that chat — on the real artifacts service, timers by hand.

type Harness = {
  project: string;
  root: string;
  run: AutoPublishRun;
  feed(message: Partial<NormalizedMessage> & { kind: NormalizedMessage['kind'] }): Promise<void>;
  /** Fires the pending debounce and waits for its publish. */
  tick(): Promise<void>;
  list(): Promise<Array<{ path: string; sessionId: string | null; latestVersion: number }>>;
  changed: string[];
  modOff: Set<string>;
};

async function withHarness(runTest: (h: Harness) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'artifacts-auto-')));
  const project = path.join(root, 'project');
  await mkdir(project);
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_records(id TEXT PRIMARY KEY,kind TEXT,owner_user_id INTEGER,project_id TEXT,revision INTEGER,payload TEXT,created_at TEXT,updated_at TEXT)');
  const changed: string[] = [];
  const modOff = new Set<string>();
  const service = createArtifactsService({
    store: createWorkspaceStore(db),
    projectPath: (id) => (id === 'p' ? project : null),
    canAccessProject: () => true,
    sessionProjectId: (_userId, sessionId) => (sessionId === 's1' ? 'p' : null),
    isModOn: (_userId, key) => !modOff.has(key),
    snapshotRoot: () => path.join(root, 'snapshots'),
    onChanged: ({ artifactId }) => { changed.push(artifactId); },
  });
  let timer: (() => void) | null = null;
  let lastPublish: Promise<void> = Promise.resolve();
  const auto = createArtifactAutoPublish({
    publish: (userId, projectId, input) => {
      const done = service.publish(userId, projectId, input);
      lastPublish = done.then(() => undefined, () => undefined);
      return done;
    },
    projectPath: (id) => (id === 'p' ? project : null),
    setTimer: (fn) => { timer = fn; return fn; },
    clearTimer: () => { timer = null; },
  });
  const run: AutoPublishRun = { runId: 'r1', appSessionId: 's1', userId: 1, projectId: 'p' };
  let seq = 0;
  const harness: Harness = {
    project,
    root,
    run,
    changed,
    modOff,
    async feed(message) {
      seq += 1;
      await auto.observe(run, { id: `m${seq}`, sessionId: 's1', timestamp: '', provider: 'claude', ...message } as NormalizedMessage);
    },
    async tick() {
      const fire = timer;
      timer = null;
      fire?.();
      await new Promise((resolve) => setImmediate(resolve));
      await lastPublish;
    },
    list: async () => (await service.list(1, 'p')).map((item) => ({ path: item.path, sessionId: item.sessionId, latestVersion: item.latestVersion })),
  };
  try {
    await runTest(harness);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}

test('Claude Write of a page: published to this chat after the tool result, list notified', async () => {
  await withHarness(async (h) => {
    const file = path.join(h.project, 'site', 'index.html');
    await mkdir(path.dirname(file), { recursive: true });
    await h.feed({ kind: 'tool_use', toolName: 'Write', toolId: 't1', toolInput: { file_path: file, content: '<h1>a</h1>' } });
    await h.tick();
    assert.deepEqual(await h.list(), [], 'nothing before the tool result: the file is not written yet');

    await writeFile(file, '<h1>a</h1>');
    await h.feed({ kind: 'tool_result', toolId: 't1', content: 'ok' });
    await h.tick();
    assert.deepEqual(await h.list(), [{ path: 'site/index.html', sessionId: 's1', latestVersion: 1 }]);
    assert.equal(h.changed.length, 1);
  });
});

test('only pages inside the project: code, dot folders, build output and outside files are skipped', async () => {
  await withHarness(async (h) => {
    const files = ['src/app.ts', '.autopilot/run/dashboard.html', 'node_modules/x/index.html', 'dist/index.html', 'notes.md'];
    for (const [index, rel] of files.entries()) {
      const file = path.join(h.project, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, 'x');
      await h.feed({ kind: 'tool_use', toolName: 'Write', toolId: `t${index}`, toolInput: { file_path: file } });
      await h.feed({ kind: 'tool_result', toolId: `t${index}` });
    }
    const outside = path.join(h.root, 'outside.html');
    await writeFile(outside, 'x');
    await h.feed({ kind: 'tool_use', toolName: 'Write', toolId: 'out', toolInput: { file_path: outside } });
    await h.feed({ kind: 'tool_result', toolId: 'out' });
    await h.feed({ kind: 'complete' });
    assert.deepEqual(await h.list(), []);
  });
});

test('Codex file change (relative path) is published without a tool result; SVG counts', async () => {
  await withHarness(async (h) => {
    await writeFile(path.join(h.project, 'logo.svg'), '<svg/>');
    await h.feed({ kind: 'tool_use', provider: 'codex', toolName: 'FileChanges', toolId: 'c1', toolInput: [{ path: 'logo.svg', kind: 'add' }] });
    await h.tick();
    assert.deepEqual((await h.list()).map((item) => item.path), ['logo.svg']);
  });
});

test('a failed write is not published; a result that never came is published at the end of the turn', async () => {
  await withHarness(async (h) => {
    await writeFile(path.join(h.project, 'failed.html'), 'x');
    await writeFile(path.join(h.project, 'grok.html'), 'x');
    await h.feed({ kind: 'tool_use', toolName: 'Edit', toolId: 'e1', toolInput: { file_path: path.join(h.project, 'failed.html') } });
    await h.feed({ kind: 'tool_result', toolId: 'e1', isError: true });
    await h.feed({ kind: 'tool_use', provider: 'grok', toolName: 'write_file', toolId: 'g1', toolInput: JSON.stringify({ path: path.join(h.project, 'grok.html') }) });
    await h.feed({ kind: 'complete' });
    assert.deepEqual((await h.list()).map((item) => item.path), ['grok.html']);
  });
});

test('repeated writes: one artifact, a new version only when the content changed', async () => {
  await withHarness(async (h) => {
    const file = path.join(h.project, 'deck.html');
    const write = async (id: string, content: string) => {
      await writeFile(file, content);
      await h.feed({ kind: 'tool_use', toolName: 'Edit', toolId: id, toolInput: { file_path: file } });
      await h.feed({ kind: 'tool_result', toolId: id });
      await h.tick();
    };
    await write('a', 'v1');
    await write('b', 'v1');
    await write('c', 'v2');
    await h.feed({ kind: 'complete' });
    assert.deepEqual(await h.list(), [{ path: 'deck.html', sessionId: 's1', latestVersion: 2 }]);
  });
});

test('«Рабочий стол» off: nothing is published and the stream goes on', async () => {
  await withHarness(async (h) => {
    h.modOff.add('modWorkbench');
    const file = path.join(h.project, 'page.html');
    await writeFile(file, 'x');
    await h.feed({ kind: 'tool_use', toolName: 'Write', toolId: 't1', toolInput: { file_path: file } });
    await h.feed({ kind: 'tool_result', toolId: 't1' });
    await h.tick();
    await h.feed({ kind: 'complete' });
    h.modOff.clear();
    assert.deepEqual(await h.list(), []);
  });
});

import assert from 'node:assert/strict';
import { promises as nodeFs } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { createArtifactsService, type ArtifactsFs } from '@/modules/artifacts/index.js';
import type { IsModOn } from '@/shared/mods.js';

// «Правка артефактов»: saving an edited document as a new version without
// overwriting the agent's parallel change, and the editor's copy with a bridge.
// Through the public service, on a real file system in a temporary folder.

type Grant = { root: string; relPath: string; html: string; userId: number; projectId: string };

async function fixture(options: { off?: string[]; limits?: { text: number; binary: number }; fs?: (real: ArtifactsFs) => ArtifactsFs } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'artifacts-edit-')));
  const project = path.join(root, 'project');
  const outside = path.join(root, 'outside');
  await mkdir(project, { recursive: true });
  await mkdir(outside, { recursive: true });
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_records(id TEXT PRIMARY KEY,kind TEXT,owner_user_id INTEGER,project_id TEXT,revision INTEGER,payload TEXT,created_at TEXT,updated_at TEXT)');
  const isModOn: IsModOn = (_userId, key) => !(options.off ?? []).includes(key);
  const grants: Grant[] = [];
  const service = createArtifactsService({
    store: createWorkspaceStore(db),
    projectPath: (id) => (id === 'p' ? project : null),
    canAccessProject: (userId) => userId === 1,
    isModOn,
    fs: options.fs ? options.fs(nodeFs) : undefined,
    snapshotRoot: () => path.join(root, 'snapshots'),
    limits: options.limits,
    documentGrant: (input) => {
      grants.push(input);
      return { token: `t${grants.length}`, url: `/api/file-preview/t${grants.length}/${input.relPath}` };
    },
  });
  const close = async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  };
  return { service, project, outside, grants, close };
}

const rejectsWith = (statusCode: number, code?: string) => (error: { statusCode?: number; code?: string }) => (
  error.statusCode === statusCode && (code === undefined || error.code === code)
);

test('saveEdit writes the file and adds an «edit» version; the next save starts from it', async () => {
  const { service, project, close } = await fixture();
  try {
    await writeFile(path.join(project, 'page.html'), '<h1>v1</h1>');
    const { artifact } = await service.publish(1, 'p', { path: 'page.html' });
    const saved = await service.saveEdit(1, 'p', artifact.id, { content: '<h1>правка</h1>', baseVersionN: 1 });
    assert.equal(await readFile(path.join(project, 'page.html'), 'utf8'), '<h1>правка</h1>');
    assert.deepEqual(saved.versions.map((v) => [v.n, v.source]), [[1, 'publish'], [2, 'edit']]);
    assert.equal(saved.artifact.latestVersion, 2);
    assert.equal((await service.versionContent(1, 'p', artifact.id, 2)).data.toString('utf8'), '<h1>правка</h1>');
    const again = await service.saveEdit(1, 'p', artifact.id, { content: '<h1>ещё</h1>', baseVersionN: 2 });
    assert.deepEqual(again.versions.map((v) => v.source), ['publish', 'edit', 'edit']);
  } finally {
    await close();
  }
});

test('the agent changed the file after the editor opened: 409 ARTIFACT_EDIT_CONFLICT with the latest version, the file is not touched', async () => {
  const { service, project, close } = await fixture();
  try {
    await writeFile(path.join(project, 'page.html'), '<h1>v1</h1>');
    const { artifact } = await service.publish(1, 'p', { path: 'page.html' });
    await writeFile(path.join(project, 'page.html'), '<h1>агент</h1>');
    await assert.rejects(service.saveEdit(1, 'p', artifact.id, { content: '<h1>моя</h1>', baseVersionN: 1 }), (error: { statusCode?: number; code?: string; details?: { latestVersion?: number } }) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'ARTIFACT_EDIT_CONFLICT');
      assert.equal(error.details?.latestVersion, 2, 'the agent\'s change became the latest version');
      return true;
    });
    assert.equal(await readFile(path.join(project, 'page.html'), 'utf8'), '<h1>агент</h1>');
    // A base older than the latest version is a conflict too, even when the disk matches the latest.
    await assert.rejects(service.saveEdit(1, 'p', artifact.id, { content: '<h1>моя</h1>', baseVersionN: 1 }), rejectsWith(409, 'ARTIFACT_EDIT_CONFLICT'));
    await assert.rejects(service.saveEdit(1, 'p', artifact.id, { content: '<h1>моя</h1>', baseVersionN: 7 }), rejectsWith(409, 'ARTIFACT_EDIT_CONFLICT'));
    const ok = await service.saveEdit(1, 'p', artifact.id, { content: '<h1>моя</h1>', baseVersionN: 2 });
    assert.deepEqual(ok.versions.map((v) => v.source), ['publish', 'change', 'edit']);
  } finally {
    await close();
  }
});

test('refusals: mod off, no access, unsupported kind, over the text limit, bad input', async () => {
  const { service, project, close } = await fixture({ limits: { text: 20, binary: 100 } });
  try {
    await writeFile(path.join(project, 'page.html'), '<p>a</p>');
    await writeFile(path.join(project, 'notes.md'), '# a');
    await writeFile(path.join(project, 'pic.png'), Buffer.alloc(4, 1));
    await writeFile(path.join(project, 'pic.svg'), '<svg/>');
    const page = (await service.publish(1, 'p', { path: 'page.html' })).artifact;
    const md = (await service.publish(1, 'p', { path: 'notes.md' })).artifact;
    const png = (await service.publish(1, 'p', { path: 'pic.png' })).artifact;
    const svg = (await service.publish(1, 'p', { path: 'pic.svg' })).artifact;
    await assert.rejects(service.saveEdit(2, 'p', page.id, { content: '<p>b</p>', baseVersionN: 1 }), rejectsWith(403));
    await assert.rejects(service.saveEdit(1, 'p', md.id, { content: '# b', baseVersionN: 1 }), rejectsWith(400, 'ARTIFACT_EDIT_UNSUPPORTED'));
    await assert.rejects(service.saveEdit(1, 'p', png.id, { content: 'x', baseVersionN: 1 }), rejectsWith(400, 'ARTIFACT_EDIT_UNSUPPORTED'));
    await assert.rejects(service.saveEdit(1, 'p', page.id, { content: '<p>'.padEnd(21, 'x'), baseVersionN: 1 }), rejectsWith(413, 'ARTIFACT_EDIT_TOO_LARGE'));
    await assert.rejects(service.saveEdit(1, 'p', page.id, { content: 5, baseVersionN: 1 }), rejectsWith(400));
    await assert.rejects(service.saveEdit(1, 'p', page.id, { content: '<p>b</p>', baseVersionN: 'x' }), rejectsWith(400));
    assert.equal(await readFile(path.join(project, 'page.html'), 'utf8'), '<p>a</p>');
    const svgSaved = await service.saveEdit(1, 'p', svg.id, { content: '<svg><g/></svg>', baseVersionN: 1 });
    assert.equal(svgSaved.versions.at(-1)?.source, 'edit');
  } finally {
    await close();
  }
  for (const off of [['modArtifactEditor'], ['modWorkbench']]) {
    const disabled = await fixture({ off });
    try {
      await writeFile(path.join(disabled.project, 'page.html'), '<p>a</p>');
      // Published while the mods were on — a second service over a fresh store is enough to check the switch.
      await assert.rejects(disabled.service.saveEdit(1, 'p', 'any', { content: '<p>b</p>', baseVersionN: 1 }), rejectsWith(409, 'MOD_OFF'), off[0]);
      await assert.rejects(disabled.service.editorPreview(1, 'p', 'any', { html: '<p>b</p>' }), rejectsWith(409, 'MOD_OFF'), off[0]);
    } finally {
      await disabled.close();
    }
  }
});

test('paths at save time: a link swapped outside, into a private file or onto a non-page file is refused, nothing is written', async () => {
  const { service, project, outside, close } = await fixture();
  try {
    await writeFile(path.join(project, 'page.html'), '<p>a</p>');
    await writeFile(path.join(project, '.env.html'), 'KEY=1');
    await writeFile(path.join(project, 'package.json'), '{}');
    await writeFile(path.join(outside, 'x.html'), '<p>outside</p>');
    const { artifact } = await service.publish(1, 'p', { path: 'page.html' });
    for (const target of [path.join(outside, 'x.html'), path.join(project, '.env.html'), path.join(project, 'package.json')]) {
      await unlink(path.join(project, 'page.html'));
      await symlink(target, path.join(project, 'page.html'));
      await assert.rejects(service.saveEdit(1, 'p', artifact.id, { content: '<p>b</p>', baseVersionN: 1 }), rejectsWith(400), target);
      await assert.rejects(service.editorPreview(1, 'p', artifact.id, { html: '<p>b</p>' }), rejectsWith(400), target);
    }
    assert.equal(await readFile(path.join(outside, 'x.html'), 'utf8'), '<p>outside</p>');
    assert.equal(await readFile(path.join(project, '.env.html'), 'utf8'), 'KEY=1');
    assert.equal(await readFile(path.join(project, 'package.json'), 'utf8'), '{}');
  } finally {
    await close();
  }
});

test('a link swapped after the content was checked and before the write is refused: realpath is re-checked right before writeFile', async () => {
  let swap: (() => Promise<void>) | null = null;
  const { service, project, outside, close } = await fixture({
    fs: (real) => ({
      ...real,
      // The swap happens while the service reads the current content (the conflict check).
      readFile: (async (...args: Parameters<typeof real.readFile>) => {
        const data = await real.readFile(...args);
        const pending = swap;
        swap = null;
        if (pending) await pending();
        return data;
      }) as typeof real.readFile,
    }),
  });
  try {
    await writeFile(path.join(project, 'page.html'), '<p>a</p>');
    await writeFile(path.join(outside, 'x.html'), '<p>outside</p>');
    const { artifact } = await service.publish(1, 'p', { path: 'page.html' });
    swap = async () => {
      await unlink(path.join(project, 'page.html'));
      await symlink(path.join(outside, 'x.html'), path.join(project, 'page.html'));
    };
    await assert.rejects(service.saveEdit(1, 'p', artifact.id, { content: '<p>b</p>', baseVersionN: 1 }), rejectsWith(400, 'ARTIFACT_PATH_OUTSIDE_PROJECT'));
    assert.equal(await readFile(path.join(outside, 'x.html'), 'utf8'), '<p>outside</p>');
    assert.deepEqual((await service.detail(1, 'p', artifact.id)).versions.map((v) => v.n), [1]);
  } finally {
    await close();
  }
});

test('editorPreview hands the copy to a document grant at the real path of the file; same refusals as saving', async () => {
  const { service, project, grants, close } = await fixture({ limits: { text: 40, binary: 100 } });
  try {
    await mkdir(path.join(project, 'site'));
    await writeFile(path.join(project, 'site', 'deck-slides.html'), '<section>1</section>');
    await writeFile(path.join(project, 'notes.md'), '# a');
    const deck = (await service.publish(1, 'p', { path: 'site/deck-slides.html' })).artifact;
    assert.equal(deck.kind, 'slides');
    const md = (await service.publish(1, 'p', { path: 'notes.md' })).artifact;
    const preview = await service.editorPreview(1, 'p', deck.id, { html: '<script data-neo3-bridge></script>' });
    assert.equal(preview.url, '/api/file-preview/t1/site/deck-slides.html');
    assert.deepEqual(grants, [{ root: project, relPath: 'site/deck-slides.html', html: '<script data-neo3-bridge></script>', userId: 1, projectId: 'p' }]);
    await assert.rejects(service.editorPreview(1, 'p', md.id, { html: '<p>' }), rejectsWith(400, 'ARTIFACT_EDIT_UNSUPPORTED'));
    await assert.rejects(service.editorPreview(1, 'p', deck.id, { html: ''.padEnd(41, 'x') }), rejectsWith(413, 'ARTIFACT_EDIT_TOO_LARGE'));
    await assert.rejects(service.editorPreview(2, 'p', deck.id, { html: '<p>' }), rejectsWith(403));
    await assert.rejects(service.editorPreview(1, 'p', deck.id, { html: null }), rejectsWith(400));
    assert.equal(grants.length, 1);
  } finally {
    await close();
  }
});

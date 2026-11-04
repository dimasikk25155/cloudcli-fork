import assert from 'node:assert/strict';
import { promises as nodeFs } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { createArtifactsService, type ArtifactsDependencies, type ArtifactsFs } from '@/modules/artifacts/index.js';
import { createFilePreviewService } from '@/modules/file-preview/index.js';
import type { IsModOn } from '@/shared/mods.js';

// «Правка артефактов»: saving an edited document as a new version without
// overwriting the agent's parallel change, and the editor's copy with a bridge.
// Through the public service, on a real file system in a temporary folder.

type Grant = { root: string; relPath: string; html: string; userId: number; projectId: string };

async function fixture(options: { off?: string[]; limits?: { text: number; binary: number }; fs?: (real: ArtifactsFs) => ArtifactsFs; documentGrant?: ArtifactsDependencies['documentGrant'] } = {}) {
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
    documentGrant: options.documentGrant ?? ((input) => {
      grants.push(input);
      return { token: `t${grants.length}`, url: `/api/file-preview/t${grants.length}/${input.relPath}` };
    }),
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

/**
 * A file system whose next write-side call on the target (open or writeFile)
 * first runs the pending swap: the file is replaced after every check and
 * right before the bytes go to disk.
 */
function swapBeforeWrite(state: { target: string | null; swap: (() => Promise<void>) | null }) {
  return (real: ArtifactsFs): ArtifactsFs => {
    const maybeSwap = async (file: unknown) => {
      const pending = state.swap;
      if (pending && String(file) === state.target) {
        state.swap = null;
        await pending();
      }
    };
    return {
      ...real,
      open: (async (...args: Parameters<typeof real.open>) => {
        await maybeSwap(args[0]);
        return real.open(...args);
      }) as typeof real.open,
      writeFile: (async (...args: Parameters<typeof real.writeFile>) => {
        await maybeSwap(args[0]);
        return real.writeFile(...args);
      }) as typeof real.writeFile,
    };
  };
}

test('saveEdit and restore: the file swapped right before the write (a link outside or another file) — 400, nothing is written anywhere', async () => {
  const state: { target: string | null; swap: (() => Promise<void>) | null } = { target: null, swap: null };
  const { service, project, outside, close } = await fixture({ fs: swapBeforeWrite(state) });
  try {
    const page = path.join(project, 'page.html');
    const outsidePage = path.join(outside, 'x.html');
    state.target = page;
    await writeFile(page, '<p>a</p>');
    await writeFile(outsidePage, '<p>outside</p>');
    const { artifact } = await service.publish(1, 'p', { path: 'page.html' });
    const toLink = async () => {
      await unlink(page);
      await symlink(outsidePage, page);
    };
    const toOtherFile = async () => {
      await writeFile(path.join(project, 'other.tmp'), '<p>другой файл</p>');
      await rename(path.join(project, 'other.tmp'), page);
    };
    const reset = async (text: string) => {
      await unlink(page);
      await writeFile(page, text);
    };

    state.swap = toLink;
    await assert.rejects(service.saveEdit(1, 'p', artifact.id, { content: '<p>b</p>', baseVersionN: 1 }), rejectsWith(400));
    assert.equal(await readFile(outsidePage, 'utf8'), '<p>outside</p>', 'saveEdit wrote through the swapped link');

    await reset('<p>a</p>');
    state.swap = toOtherFile;
    await assert.rejects(service.saveEdit(1, 'p', artifact.id, { content: '<p>b</p>', baseVersionN: 1 }), rejectsWith(400));
    assert.equal(await readFile(page, 'utf8'), '<p>другой файл</p>', 'saveEdit wrote into a file it did not check');
    assert.deepEqual((await service.detail(1, 'p', artifact.id)).versions.map((v) => v.n), [1]);

    await reset('<p>c</p>');
    state.swap = toLink;
    await assert.rejects(service.restore(1, 'p', artifact.id, 1), rejectsWith(400));
    assert.equal(await readFile(outsidePage, 'utf8'), '<p>outside</p>', 'restore wrote through the swapped link');

    await reset('<p>c</p>');
    state.swap = toOtherFile;
    await assert.rejects(service.restore(1, 'p', artifact.id, 1), rejectsWith(400));
    assert.equal(await readFile(page, 'utf8'), '<p>другой файл</p>', 'restore wrote into a file it did not check');

    // Without a swap both still write.
    await reset('<p>a</p>');
    const latest = (await service.refresh(1, 'p', artifact.id)).artifact.latestVersion;
    const saved = await service.saveEdit(1, 'p', artifact.id, { content: '<p>моя</p>', baseVersionN: latest });
    assert.equal(saved.versions.at(-1)?.source, 'edit');
    assert.equal(await readFile(page, 'utf8'), '<p>моя</p>');
    await service.restore(1, 'p', artifact.id, 1);
    assert.equal(await readFile(page, 'utf8'), '<p>a</p>');
    // A deleted file is written back as a new file in its folder.
    await unlink(page);
    await service.restore(1, 'p', artifact.id, 1);
    assert.equal(await readFile(page, 'utf8'), '<p>a</p>');
  } finally {
    await close();
  }
});

test('two saves from the same version at once: one passes, the other gets 409; the file and the snapshot of the new version match its sha', async () => {
  const { service, project, close } = await fixture();
  try {
    await writeFile(path.join(project, 'page.html'), '<h1>v1</h1>');
    const { artifact } = await service.publish(1, 'p', { path: 'page.html' });
    const results = await Promise.allSettled([
      service.saveEdit(1, 'p', artifact.id, { content: '<h1>первая</h1>', baseVersionN: 1 }),
      service.saveEdit(1, 'p', artifact.id, { content: '<h1>вторая правка</h1>', baseVersionN: 1 }),
    ]);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(refused.length, 1);
    assert.equal(refused[0].reason?.statusCode, 409, String(refused[0].reason));
    assert.equal(refused[0].reason?.code, 'ARTIFACT_EDIT_CONFLICT');
    const detail = await service.detail(1, 'p', artifact.id);
    assert.deepEqual(detail.versions.map((v) => [v.n, v.source]), [[1, 'publish'], [2, 'edit']]);
    const sha = createHash('sha256').update(await readFile(path.join(project, 'page.html'))).digest('hex');
    const snapshot = (await service.versionContent(1, 'p', artifact.id, 2)).data;
    assert.equal(detail.versions[1].sha256, sha, 'the version sha is the file on disk');
    assert.equal(createHash('sha256').update(snapshot).digest('hex'), sha, 'the snapshot is the file on disk');
  } finally {
    await close();
  }
});

test('editorPreview of a page in a dot folder (.autopilot/…) — a 4xx with its own code and a Russian message, not 500', async () => {
  const previews = createFilePreviewService();
  const { service, project, close } = await fixture({ documentGrant: (input) => previews.createDocumentGrant(input) });
  try {
    await mkdir(path.join(project, '.autopilot', 'run'), { recursive: true });
    await writeFile(path.join(project, '.autopilot', 'run', 'report.html'), '<h1>отчёт</h1>');
    const { artifact } = await service.publish(1, 'p', { path: '.autopilot/run/report.html' });
    await assert.rejects(service.editorPreview(1, 'p', artifact.id, { html: '<h1>отчёт</h1>' }), (error: { statusCode?: number; code?: string; message?: string }) => {
      assert.ok(error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500, `status ${error.statusCode}`);
      assert.equal(error.code, 'ARTIFACT_EDIT_HIDDEN_FOLDER');
      assert.match(error.message ?? '', /[а-яё]/i);
      return true;
    });
    // An ordinary folder still goes through the same grant table.
    await mkdir(path.join(project, 'site'));
    await writeFile(path.join(project, 'site', 'page.html'), '<p>a</p>');
    const page = (await service.publish(1, 'p', { path: 'site/page.html' })).artifact;
    assert.match((await service.editorPreview(1, 'p', page.id, { html: '<p>a</p>' })).url, /^\/api\/file-preview\/[0-9a-f]+\/site\/page\.html$/);
  } finally {
    await close();
  }
});

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveAgainstRoots } from '../file-reference-resolver.js';

let tmpRoot;
let projectRoot;
let workspaceRoot;
let vaultNote;

before(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-ref-resolver-'));
    projectRoot = path.join(tmpRoot, 'project');
    workspaceRoot = path.join(tmpRoot, 'workspace');
    // The vault is NOT a registered project — it only lives inside one.
    vaultNote = path.join(workspaceRoot, 'obsidian', 'vault', 'wiki', 'concepts', 'note.md');

    // Lives one level above the project, like a workspace-wide secrets file.
    await fs.writeFile(path.join(tmpRoot, '.secrets.env'), 'ABOVE=1');

    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'index.js'), 'in project');
    await fs.mkdir(path.join(workspaceRoot, 'sibling', 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'sibling', 'docs', 'readme.md'), 'in sibling');
    await fs.mkdir(path.dirname(vaultNote), { recursive: true });
    await fs.writeFile(vaultNote, 'in vault');
});

after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('resolveAgainstRoots', () => {
    it('resolves a project-relative path against the project root', async () => {
        const outcome = await resolveAgainstRoots({
            filePath: 'src/index.js',
            projectRoot,
            fallbackRoots: [],
            isAdmin: true,
        });

        assert.deepEqual(outcome, { ok: true, resolved: path.join(projectRoot, 'src', 'index.js') });
    });

    it('keeps a not-yet-created path inside the project so new files can be saved', async () => {
        const outcome = await resolveAgainstRoots({
            filePath: 'src/new-file.js',
            projectRoot,
            fallbackRoots: [path.join(workspaceRoot, 'sibling')],
            isAdmin: true,
        });

        assert.deepEqual(outcome, { ok: true, resolved: path.join(projectRoot, 'src', 'new-file.js') });
    });

    it('falls back to another root when the file lives in a different project', async () => {
        const outcome = await resolveAgainstRoots({
            filePath: 'docs/readme.md',
            projectRoot,
            fallbackRoots: [path.join(workspaceRoot, 'sibling')],
            isAdmin: true,
        });

        assert.equal(outcome.ok, true);
        assert.equal(outcome.resolved, path.join(workspaceRoot, 'sibling', 'docs', 'readme.md'));
    });

    it('finds a file whose own root is nested inside a known root (vault case)', async () => {
        const outcome = await resolveAgainstRoots({
            filePath: 'wiki/concepts/note.md',
            projectRoot,
            fallbackRoots: [workspaceRoot],
            isAdmin: true,
        });

        assert.equal(outcome.ok, true);
        assert.equal(outcome.resolved, vaultNote);
    });

    it('rejects a guest reference that escapes every allowed root', async () => {
        const outcome = await resolveAgainstRoots({
            filePath: '../workspace/sibling/docs/readme.md',
            projectRoot,
            fallbackRoots: [],
            isAdmin: false,
        });

        assert.equal(outcome.ok, false);
        assert.equal(outcome.status, 403);
    });

    it('finds a file that sits above the project root (shared .env case)', async () => {
        const outcome = await resolveAgainstRoots({
            filePath: '.secrets.env',
            projectRoot,
            fallbackRoots: [],
            isAdmin: true,
        });

        assert.equal(outcome.ok, true);
        assert.equal(outcome.resolved, path.join(tmpRoot, '.secrets.env'));
    });

    it('does not climb above the project root for a guest', async () => {
        const outcome = await resolveAgainstRoots({
            filePath: '.secrets.env',
            projectRoot,
            fallbackRoots: [],
            isAdmin: false,
        });

        // Resolution stays project-local so the miss reports 404, not someone
        // else's file.
        assert.deepEqual(outcome, { ok: true, resolved: path.join(projectRoot, '.secrets.env') });
    });

    it('never resolves a relative save outside the project (allowSearch off)', async () => {
        const outcome = await resolveAgainstRoots({
            filePath: '.secrets.env',
            projectRoot,
            fallbackRoots: [path.join(workspaceRoot, 'sibling')],
            isAdmin: true,
            allowSearch: false,
        });

        assert.deepEqual(outcome, { ok: true, resolved: path.join(projectRoot, '.secrets.env') });
    });

    it('lets an admin open an absolute path outside the project', async () => {
        const outcome = await resolveAgainstRoots({
            filePath: vaultNote,
            projectRoot,
            fallbackRoots: [],
            isAdmin: true,
        });

        assert.deepEqual(outcome, { ok: true, resolved: vaultNote });
    });
});

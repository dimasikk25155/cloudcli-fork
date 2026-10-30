import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isRelayNoteWrite } from '../../shared/relay-note-permission.js';
// The handoff turn may write only a Markdown note inside <project>/docs/handoff/
// without asking; everything else keeps the usual approval.
async function withProject(run) {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'relay-note-permission-')));
    const project = path.join(root, 'My Project');
    const outside = path.join(root, 'outside');
    await mkdir(project, { recursive: true });
    await mkdir(outside, { recursive: true });
    try {
        await run(project, path.join(project, 'docs', 'handoff'), outside);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
}
test('Write and Edit of a .md note inside docs/handoff pass, even before the folder exists', async () => {
    await withProject(async (project, noteDir) => {
        const note = path.join(noteDir, '2026-10-13-cafe.md');
        assert.equal(isRelayNoteWrite('Write', { file_path: note }, noteDir), true);
        assert.equal(isRelayNoteWrite('Edit', { file_path: note }, noteDir), true);
        assert.equal(isRelayNoteWrite('Write', { file_path: 'docs/handoff/relative.md' }, noteDir), true);
        assert.equal(isRelayNoteWrite('Write', { file_path: path.join(project, 'README.md') }, noteDir), false);
    });
});
test('other tools, other files and escapes keep asking', async () => {
    await withProject(async (project, noteDir, outside) => {
        assert.equal(isRelayNoteWrite('Bash', { command: 'rm -rf /' }, noteDir), false);
        assert.equal(isRelayNoteWrite('Write', { file_path: path.join(noteDir, 'run.sh') }, noteDir), false);
        assert.equal(isRelayNoteWrite('Write', { file_path: `${noteDir}/../../../outside/x.md` }, noteDir), false);
        assert.equal(isRelayNoteWrite('Write', { file_path: path.join(outside, 'x.md') }, noteDir), false);
        assert.equal(isRelayNoteWrite('Write', { file_path: noteDir }, noteDir), false);
        assert.equal(isRelayNoteWrite('Write', { file_path: path.join(noteDir, 'a.md') }, undefined), false);
        assert.equal(isRelayNoteWrite('Write', {}, noteDir), false);
    });
});
test('a docs/handoff symlinked out of the project is refused', async () => {
    await withProject(async (project, noteDir, outside) => {
        await mkdir(path.join(project, 'docs'), { recursive: true });
        await symlink(outside, noteDir);
        assert.equal(isRelayNoteWrite('Write', { file_path: path.join(noteDir, 'note.md') }, noteDir), false);
    });
});
//# sourceMappingURL=relay-note-permission.test.js.map
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listVaultNotes, writeVaultNote } from '@/modules/memory-suggestions/vault-writer.js';

// Spec story 48: «Записать» creates a file in the vault, never overwrites
// (taken → suffix), and the path stays strictly inside the vault root.

async function tempVault(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo3-vault-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return fs.realpath(dir);
}

test('writes the note under <vault>/<folder>/<slug>.md and returns where', async (t) => {
  const vault = await tempVault(t);
  const result = await writeVaultNote({ vaultDir: vault, folder: 'wiki/synthesis', title: 'Ollama Context Window', body: 'BODY' });
  assert.equal(result.relativePath, 'wiki/synthesis/ollama-context-window.md');
  assert.equal(result.absolutePath, path.join(vault, 'wiki', 'synthesis', 'ollama-context-window.md'));
  assert.equal(await fs.readFile(result.absolutePath, 'utf8'), 'BODY');
});

test('an existing note is never overwritten: the new one gets a suffix', async (t) => {
  const vault = await tempVault(t);
  await fs.mkdir(path.join(vault, 'wiki', 'concepts'), { recursive: true });
  const existing = path.join(vault, 'wiki', 'concepts', 'hooks.md');
  await fs.writeFile(existing, 'OLD');

  const second = await writeVaultNote({ vaultDir: vault, folder: 'wiki/concepts', title: 'Hooks', body: 'NEW' });
  const third = await writeVaultNote({ vaultDir: vault, folder: 'wiki/concepts', title: 'Hooks', body: 'NEWER' });

  assert.equal(await fs.readFile(existing, 'utf8'), 'OLD');
  assert.equal(second.relativePath, 'wiki/concepts/hooks-2.md');
  assert.equal(third.relativePath, 'wiki/concepts/hooks-3.md');
  assert.equal(await fs.readFile(third.absolutePath, 'utf8'), 'NEWER');
});

test('path traversal is impossible: nothing is written outside the vault', async (t) => {
  const parent = await tempVault(t);
  const vault = path.join(parent, 'vault');
  await fs.mkdir(vault);

  for (const folder of ['../escape', '/tmp', 'wiki/../../escape', '..']) {
    await assert.rejects(writeVaultNote({ vaultDir: vault, folder, title: 'x', body: 'x' }), folder);
  }
  // A title full of separators only shapes the file name.
  const sneaky = await writeVaultNote({ vaultDir: vault, folder: 'wiki/synthesis', title: '../../../etc/passwd', body: 'x' });
  assert.equal(sneaky.relativePath, 'wiki/synthesis/etc-passwd.md');
  assert.deepEqual((await fs.readdir(parent)).sort(), ['vault']);
});

test('a folder symlinked out of the vault is refused', async (t) => {
  const parent = await tempVault(t);
  const vault = path.join(parent, 'vault');
  const outside = path.join(parent, 'outside');
  await fs.mkdir(vault);
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(vault, 'Linked'));

  await assert.rejects(writeVaultNote({ vaultDir: vault, folder: 'Linked', title: 'x', body: 'x' }));
  assert.deepEqual(await fs.readdir(outside), []);
});

test('a symlink out of the vault in the middle of the path: refused, nothing created outside', async (t) => {
  const parent = await tempVault(t);
  const vault = path.join(parent, 'vault');
  const outside = path.join(parent, 'outside');
  await fs.mkdir(vault);
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(vault, 'wiki'));

  await assert.rejects(writeVaultNote({ vaultDir: vault, folder: 'wiki/synthesis', title: 'x', body: 'x' }));
  assert.deepEqual(await fs.readdir(outside), [], 'no folder was created through the link');
});

test('listVaultNotes: every .md as a path without extension, hidden folders skipped', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo3-vault-'));
  await fs.mkdir(path.join(dir, 'wiki', 'entities'), { recursive: true });
  await fs.mkdir(path.join(dir, '.obsidian'));
  await fs.writeFile(path.join(dir, 'wiki', 'entities', 'insta-comments.md'), '# x');
  await fs.writeFile(path.join(dir, 'wiki', 'image.png'), '');
  await fs.writeFile(path.join(dir, '.obsidian', 'hidden.md'), '');
  await fs.writeFile(path.join(dir, 'index.md'), '');
  assert.deepEqual(await listVaultNotes(dir), ['index', 'wiki/entities/insta-comments']);
  assert.deepEqual(await listVaultNotes(path.join(dir, 'missing')), []);
});

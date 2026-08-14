import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getProjectStats } from '@/shared/project-stats.js';

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-stats-'));
  fs.writeFileSync(path.join(root, 'app.ts'), 'const a = 1;\nconst b = 2;\n');
  fs.writeFileSync(path.join(root, 'readme.md'), '# Title\n');
  // No trailing newline: the last line must still be counted.
  fs.writeFileSync(path.join(root, 'util.js'), 'export const x = 1;');

  // Generated code that must never reach the totals.
  fs.mkdirSync(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'node_modules', 'left-pad', 'index.js'),
    'module.exports = 1;\n'.repeat(500),
  );
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), 'x\n'.repeat(999));

  // A binary blob adds weight but no lines.
  fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
  return root;
}

test('generated folders stay out of the numbers', async () => {
  const root = makeProject();
  try {
    const stats = await getProjectStats(root);
    // 3 source files + 1 binary; node_modules/ and dist/ excluded entirely.
    assert.equal(stats.files, 4);
    // 2 + 1 + 1 lines; the 1499 generated lines must not appear.
    assert.equal(stats.lines, 4);
    assert.equal(stats.name, path.basename(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('binary files add size but never lines', async () => {
  const root = makeProject();
  try {
    const stats = await getProjectStats(root);
    const exts = stats.languages.map((l) => l.ext);
    assert.ok(!exts.includes('.png'), 'a PNG is not a language');
    assert.ok(stats.bytes > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable project reports zeroes instead of throwing', async () => {
  const stats = await getProjectStats(path.join(os.tmpdir(), 'definitely-not-here-12345'));
  assert.equal(stats.files, 0);
  assert.equal(stats.lines, 0);
  assert.equal(stats.truncated, false);
});

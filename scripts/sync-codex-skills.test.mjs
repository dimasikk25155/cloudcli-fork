import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { syncCodexSkills } from './sync-codex-skills.mjs';

test('skill sync is idempotent and preserves existing Codex skills and Claude sources', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'neo3-skill-sync-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const source = path.join(home, '.claude/skills');
  for (const name of ['one', 'conflict']) {
    await fs.mkdir(path.join(source, name), { recursive: true });
    await fs.writeFile(path.join(source, name, 'SKILL.md'), name);
  }
  await fs.mkdir(path.join(home, '.agents/skills/conflict'), { recursive: true });
  await fs.writeFile(path.join(home, '.agents/skills/conflict/SKILL.md'), 'own codex skill');
  assert.deepEqual(await syncCodexSkills(home), { linked: ['one'], existing: [], conflicts: ['conflict'] });
  assert.deepEqual(await syncCodexSkills(home), { linked: [], existing: ['one'], conflicts: ['conflict'] });
  assert.equal(await fs.readFile(path.join(home, '.agents/skills/conflict/SKILL.md'), 'utf8'), 'own codex skill');
  assert.equal(await fs.readFile(path.join(source, 'one/SKILL.md'), 'utf8'), 'one');
});

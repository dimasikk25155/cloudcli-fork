#!/usr/bin/env node
// Link this user's own Claude skills into Codex. Never move or overwrite anything.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function syncCodexSkills(home = os.homedir()) {
  const source = path.join(home, '.claude', 'skills');
  const target = path.join(home, '.agents', 'skills');
  const result = { linked: [], existing: [], conflicts: [] };
  const entries = await fs.readdir(source, { withFileTypes: true }).catch(() => []);
  await fs.mkdir(target, { recursive: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const from = path.join(source, entry.name);
    if (!(await fs.stat(path.join(from, 'SKILL.md')).catch(() => null))?.isFile()) continue;
    const to = path.join(target, entry.name);
    try {
      await fs.symlink(from, to, process.platform === 'win32' ? 'junction' : 'dir');
      result.linked.push(entry.name);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const resolved = await fs.realpath(to).catch(() => null);
      const original = await fs.realpath(from);
      (resolved === original ? result.existing : result.conflicts).push(entry.name);
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await syncCodexSkills()));
}

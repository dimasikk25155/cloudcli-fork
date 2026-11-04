import assert from 'node:assert/strict';
import test from 'node:test';

import type { DiagFs } from '@/modules/diagnostics/diagnostics.types.js';
import { createSkillDoctor } from '@/modules/diagnostics/skill-doctor.js';

const skill = (name: string, description: string, body = '') => `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;

function fakeFs(files: Record<string, string>, links: Record<string, string> = {}) {
  const writes: string[] = [];
  const dirs = new Set<string>();
  for (const f of Object.keys(files)) {
    const parts = f.split('/');
    for (let i = 2; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  const fs: DiagFs = {
    readFile: async (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    readdir: async (p) => {
      const prefix = `${p}/`;
      const names = new Set<string>();
      for (const f of [...Object.keys(files), ...Object.keys(links)]) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split('/')[0]);
      if (!names.size) throw new Error('ENOENT');
      return [...names];
    },
    isDirectory: async (p) => dirs.has(p) || p in links,
    exists: async (p) => p in files || (`${p}/SKILL.md` in files) || (p in links),
    realpath: async (p) => links[p] ?? p,
    fileSize: async () => null,
  };
  return { fs, writes };
}

test('runSkillDoctor finds duplicate, empty description and broken link; changes nothing', async () => {
  const files: Record<string, string> = {
    '/h/.claude/skills/alpha/SKILL.md': skill('alpha', 'Делает альфу для проекта и всего остального'),
    '/h/.claude/skills/alpha-copy/SKILL.md': skill('alpha', 'Делает альфу для проекта и всего остального'),
    '/h/.claude/skills/empty/SKILL.md': skill('empty', ''),
    '/h/.claude/skills/linky/SKILL.md': skill('linky', 'Ссылается на файл', 'См. [гайд](missing.md) и [сайт](https://x.y/z.md)'),
    '/h/.claude/skills/doctor/SKILL.md': skill('doctor', 'Конфликт с встроенной командой'),
    '/h/.claude/skills/ok/SKILL.md': skill('ok', 'Нормальный навык с описанием', '[есть](ok.md)'),
    '/h/.claude/skills/ok/ok.md': 'x',
  };
  const { fs } = fakeFs(files);
  const before = JSON.stringify(files);
  const report = await createSkillDoctor({ fs, home: '/h', now: () => 0 }).runSkillDoctor();
  const kinds = (kind: string) => report.issues.filter((i) => i.kind === kind);
  assert.ok(kinds('duplicate').some((i) => i.skill.includes('alpha') && i.skill.includes('alpha-copy') && /alpha/.test(i.detail)));
  assert.ok(kinds('no_description').some((i) => i.skill === 'empty'));
  assert.deepEqual(kinds('broken_link').map((i) => i.skill), ['linky']);
  assert.ok(kinds('conflict').some((i) => i.skill === 'doctor'));
  assert.ok(!report.issues.some((i) => i.skill === 'ok'));
  assert.equal(report.skills.length, 6);
  assert.equal(JSON.stringify(files), before);
});

test('a Codex link to a Claude skill is counted once', async () => {
  const { fs } = fakeFs(
    { '/h/.claude/skills/alpha/SKILL.md': skill('alpha', 'Делает альфу для проекта и всего остального') },
    { '/h/.codex/skills/alpha': '/h/.claude/skills/alpha' },
  );
  // The link also answers for its SKILL.md.
  const real = fs.exists;
  fs.exists = async (p) => p === '/h/.codex/skills/alpha/SKILL.md' || real(p);
  const read = fs.readFile;
  fs.readFile = async (p) => (p === '/h/.codex/skills/alpha/SKILL.md' ? read('/h/.claude/skills/alpha/SKILL.md') : read(p));
  const report = await createSkillDoctor({ fs, home: '/h' }).runSkillDoctor();
  assert.equal(report.skills.length, 1);
  assert.equal(report.issues.filter((i) => i.kind === 'duplicate').length, 0);
});

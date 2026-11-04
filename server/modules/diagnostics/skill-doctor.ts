/**
 * /skill-doctor: read-only audit of the installed skills of Claude and Codex.
 * Same rules as the terminal skill `skill-audit`: duplicates, empty
 * descriptions, broken links, conflicts with built-in commands. Nothing is
 * deleted, renamed or moved.
 */

import path from 'node:path';

import type { DiagFs, SkillInfo, SkillIssue, SkillReport } from './diagnostics.types.js';

export type SkillDoctorDependencies = {
  fs: DiagFs;
  home: string;
  now?: () => number;
};

/** Names of built-in commands a skill must not shadow. */
const BUILTIN_COMMANDS = new Set([
  'doctor', 'skill-doctor', 'advisor', 'status', 'context', 'cost', 'help', 'config', 'compact', 'clear',
  'init', 'review', 'checkup', 'debug', 'rewind', 'model', 'memory', 'mcp', 'agents', 'hooks', 'loop',
  'simplify', 'schedule',
]);

const ROOTS: Array<{ source: 'claude' | 'codex'; segments: string[] }> = [
  { source: 'claude', segments: ['.claude', 'skills'] },
  { source: 'codex', segments: ['.codex', 'skills'] },
];

type Parsed = SkillInfo & { file: string; text: string; description: string; hasFrontmatter: boolean };

function frontmatterValue(frontmatter: string | undefined, key: string): string {
  if (!frontmatter) return '';
  const match = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(frontmatter);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

export function createSkillDoctor(deps: SkillDoctorDependencies) {
  const { fs, home } = deps;
  const now = deps.now ?? Date.now;

  async function load(): Promise<Parsed[]> {
    const parsed: Parsed[] = [];
    const seenReal = new Set<string>();
    for (const root of ROOTS) {
      const rootDir = path.join(home, ...root.segments);
      let entries: string[];
      try {
        entries = (await fs.readdir(rootDir)).sort();
      } catch {
        continue;
      }
      for (const entry of entries) {
        const dir = path.join(rootDir, entry);
        const file = path.join(dir, 'SKILL.md');
        try {
          if (!(await fs.isDirectory(dir)) || !(await fs.exists(file))) continue;
          // Codex reaches Claude's skills through links: count each skill once.
          const real = await fs.realpath(dir).catch(() => dir);
          if (seenReal.has(real)) continue;
          seenReal.add(real);
          const text = await fs.readFile(file);
          const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
          const description = frontmatterValue(frontmatter, 'description');
          parsed.push({
            dir: entry,
            name: frontmatterValue(frontmatter, 'name') || entry,
            source: root.source,
            hasDescription: Boolean(description),
            file,
            text,
            description,
            hasFrontmatter: frontmatter !== undefined,
          });
        } catch {
          // An unreadable skill is skipped, not an error of the whole report.
        }
      }
    }
    return parsed;
  }

  return {
    async runSkillDoctor(): Promise<SkillReport> {
      const skills = await load();
      const issues: SkillIssue[] = [];
      const add = (kind: SkillIssue['kind'], skill: string, detail: string) => issues.push({ kind, skill, detail });
      const byName = new Map<string, string[]>();
      const byDescription = new Map<string, string[]>();

      for (const skill of skills) {
        const label = skill.dir;
        if (!skill.hasFrontmatter) {
          add('no_description', label, 'нет блока с описанием в начале файла');
        } else if (!skill.description || skill.description === '|' || skill.description === '>') {
          // `description: |` / `>` carry the text on the following lines.
          if (!/^description:\s*[|>]/m.test(skill.text.slice(0, 4000))) add('no_description', label, 'пустое описание');
        }
        byName.set(skill.name, [...(byName.get(skill.name) ?? []), label]);
        if (skill.description.length > 20) {
          byDescription.set(skill.description, [...(byDescription.get(skill.description) ?? []), label]);
        }
        if (BUILTIN_COMMANDS.has(skill.name)) add('conflict', label, `имя «${skill.name}» совпадает со встроенной командой`);
        if (skill.name !== skill.dir) add('conflict', label, `имя «${skill.name}» не совпадает с папкой «${skill.dir}»`);

        const body = skill.text
          .replace(/^---\n[\s\S]*?\n---/, '')
          .replace(/```[\s\S]*?```/g, '')
          .replace(/`[^`\n]*`/g, '');
        for (const match of body.matchAll(/\[[^\]\n]*\]\((?!https?:|#|mailto:)([^)\s|*]+?\.[A-Za-z0-9]+)(?:#[^)]*)?\)/g)) {
          let target: string;
          try {
            target = path.resolve(path.dirname(skill.file), decodeURIComponent(match[1]));
          } catch {
            continue;
          }
          if (!(await fs.exists(target))) add('broken_link', label, `${match[1]} не найден`);
        }
      }

      for (const [name, dirs] of byName) if (dirs.length > 1) add('duplicate', dirs.join(', '), `одно имя «${name}»`);
      for (const dirs of byDescription.values()) if (dirs.length > 1) add('duplicate', dirs.join(', '), 'одинаковое описание');

      return {
        skills: skills.map(({ dir, name, source, hasDescription }) => ({ dir, name, source, hasDescription })),
        issues,
        generatedAt: new Date(now()).toISOString(),
      };
    },
  };
}

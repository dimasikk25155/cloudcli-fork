import fs from 'fs';
import path from 'path';

import { getSessionUsageHistory } from './session-usage.js';

export type ProjectStats = {
  /** Folder name shown as the heading — never the DB uuid. */
  name: string;
  path: string;
  files: number;
  lines: number;
  bytes: number;
  /** Largest languages by file count, biggest first. */
  languages: { ext: string; files: number; lines: number }[];
  sessions: number;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  lastActivity: string | null;
  /** True when the walk hit MAX_FILES and the numbers are a floor, not a total. */
  truncated: boolean;
};

// Folders that hold generated or vendored code: counting them would drown the
// project's own numbers (node_modules alone is usually 10x the source tree).
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', '.cache', 'coverage', '.turbo', 'vendor', '.gradle', 'Pods',
  'target', 'out', '.svelte-kit', '.output', 'bower_components',
]);

// Only these get read line by line; everything else contributes size but not lines.
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh',
  '.bash', '.zsh', '.sql', '.html', '.css', '.scss', '.sass', '.less', '.vue',
  '.svelte', '.json', '.yml', '.yaml', '.toml', '.ini', '.env', '.md', '.mdx',
  '.txt', '.xml', '.gradle', '.dart', '.lua', '.r', '.jl', '.ex', '.exs',
]);

const MAX_FILES = 20_000;
const MAX_LINE_COUNT_BYTES = 2 * 1024 * 1024; // don't read a 50MB log to count lines
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; stats: ProjectStats }>();

// Transcripts record `cwd` as the CLI saw it, and on this server /Users/dimasik
// is a symlink to /home/agents. Comparing the strings would drop ~96% of the
// sessions, so both sides are resolved through the real path first. Cached
// because a project match runs once per session row.
const realPathCache = new Map<string, string>();
function canonical(target: string): string {
  const resolved = path.resolve(target);
  const hit = realPathCache.get(resolved);
  if (hit) return hit;
  let real = resolved;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    // Missing path: fall back to the resolved form so comparison still works.
  }
  realPathCache.set(resolved, real);
  return real;
}

function countLines(file: string, size: number): number {
  if (size > MAX_LINE_COUNT_BYTES) return 0;
  try {
    const buf = fs.readFileSync(file);
    // A NUL byte in the first block means binary — skip rather than count noise.
    if (buf.subarray(0, 8000).includes(0)) return 0;
    let lines = 0;
    for (let i = 0; i < buf.length; i += 1) if (buf[i] === 0x0a) lines += 1;
    // Trailing line without a newline still counts.
    return buf.length > 0 && buf[buf.length - 1] !== 0x0a ? lines + 1 : lines;
  } catch {
    return 0;
  }
}

function walk(root: string) {
  const byExt = new Map<string, { files: number; lines: number }>();
  let files = 0;
  let lines = 0;
  let bytes = 0;
  let truncated = false;

  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable folder shouldn't kill the whole scan
    }

    for (const entry of entries) {
      if (files >= MAX_FILES) {
        truncated = true;
        break;
      }
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // symlinks can loop or leave the project
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }

      files += 1;
      bytes += size;

      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXT.has(ext)) {
        const fileLines = countLines(full, size);
        lines += fileLines;
        const acc = byExt.get(ext) ?? { files: 0, lines: 0 };
        acc.files += 1;
        acc.lines += fileLines;
        byExt.set(ext, acc);
      }
    }
    if (truncated) break;
  }

  const languages = [...byExt.entries()]
    .map(([ext, v]) => ({ ext, files: v.files, lines: v.lines }))
    .sort((a, b) => b.lines - a.lines || b.files - a.files)
    .slice(0, 8);

  return { files, lines, bytes, languages, truncated };
}

/**
 * Everything the Statistics tab shows for one project: size on disk plus how
 * much work with Claude it took. Session numbers are reused from
 * `session-usage` on purpose — token rates and dedup live in one place only.
 */
export async function getProjectStats(projectPath: string): Promise<ProjectStats> {
  const resolved = path.resolve(projectPath);
  const hit = cache.get(resolved);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.stats;

  const canonicalRoot = canonical(resolved);
  const walked = walk(resolved);

  let sessions = 0;
  let tokens = 0;
  let tokensOut = 0;
  let costUsd: number | null = null;
  let lastActivity: string | null = null;
  try {
    const history = await getSessionUsageHistory();
    const seen = new Set<string>();
    for (const day of history) {
      for (const s of day.sessions) {
        if (!s.projectPath || canonical(s.projectPath) !== canonicalRoot) continue;
        // A session crossing midnight appears in two days — count it once.
        if (!seen.has(s.sessionId)) {
          seen.add(s.sessionId);
          sessions += 1;
        }
        tokens += s.tokens;
        tokensOut += s.output;
        if (s.costUsd !== null) costUsd = (costUsd ?? 0) + s.costUsd;
        if (!lastActivity || s.lastActivity > lastActivity) lastActivity = s.lastActivity;
      }
    }
  } catch {
    // Usage history is a nice-to-have: a broken transcript must not blank the tab.
  }

  const stats: ProjectStats = {
    name: path.basename(resolved),
    path: resolved,
    files: walked.files,
    lines: walked.lines,
    bytes: walked.bytes,
    languages: walked.languages,
    sessions,
    tokens,
    tokensIn: Math.max(0, tokens - tokensOut),
    tokensOut,
    costUsd,
    lastActivity,
    truncated: walked.truncated,
  };

  cache.set(resolved, { at: Date.now(), stats });
  return stats;
}

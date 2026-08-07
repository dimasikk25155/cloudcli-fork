import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Pure-ish readers for the night-shift orchestrator artifacts. Kept apart from
// the route so the plist/history parsing can be tested against a temp dir.

const execFileAsync = promisify(execFile);

const RUN_PREFIX = 'ru.tarariev.claude-run-';
// Predates the `claude-run-` convention but is the same kind of machine
// watchdog, so it belongs in this list. `ru.tarariev.neo3-schedule-*` does NOT:
// those are user-created schedules with their own panel and their own store.
const EXTRA_LABELS = ['ru.tarariev.mac-lifecycle'];

// Files schedule-run.sh rewrites in place. The run directory's own mtime does
// NOT move when they change, which is why it must never be used as "last run".
const RUN_ARTIFACTS = ['run.log', 'result.txt', 'state.json', 'attempts'];

export type Schedule =
  | { kind: 'interval'; seconds: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'unknown' };

export type ScheduledRun = {
  label: string;
  schedule: Schedule;
};

export type HistoryRun = {
  label: string;
  status: 'ok' | 'fail' | 'pending';
  attempts: number | null;
  finishedAt: string | null;
  updatedAt: string;
  logTail: string[];
  resultPreview: string;
};

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function isTrackedPlist(file: string): boolean {
  if (!file.endsWith('.plist')) {
    return false;
  }
  const label = file.slice(0, -'.plist'.length);
  return label.startsWith(RUN_PREFIX) || EXTRA_LABELS.includes(label);
}

function displayLabel(file: string): string {
  const label = file.slice(0, -'.plist'.length);
  return label.startsWith(RUN_PREFIX) ? label.slice(RUN_PREFIX.length) : label.replace('ru.tarariev.', '');
}

export function parseSchedule(json: Record<string, unknown>): Schedule {
  // Interval jobs are the common case here (every 5-15 minutes); the original
  // parser only looked at StartCalendarInterval and so reported "no schedule".
  const interval = json.StartInterval;
  if (typeof interval === 'number' && interval > 0) {
    return { kind: 'interval', seconds: interval };
  }

  const cal = json.StartCalendarInterval;
  const entry = (Array.isArray(cal) ? cal[0] : cal) as Record<string, unknown> | undefined;
  if (entry && typeof entry === 'object' && typeof entry.Hour === 'number') {
    return {
      kind: 'daily',
      hour: entry.Hour,
      minute: typeof entry.Minute === 'number' ? entry.Minute : 0,
    };
  }

  return { kind: 'unknown' };
}

function scheduleRank(schedule: Schedule): number {
  // Daily jobs first (ordered by clock time), then intervals (shortest first),
  // unknown last.
  if (schedule.kind === 'daily') return schedule.hour * 60 + schedule.minute;
  if (schedule.kind === 'interval') return 10_000 + schedule.seconds;
  return 1_000_000;
}

export async function readScheduled(launchAgentsDir: string): Promise<ScheduledRun[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(launchAgentsDir);
  } catch {
    return [];
  }

  const out: ScheduledRun[] = [];
  for (const file of files) {
    if (!isTrackedPlist(file)) {
      continue;
    }
    let schedule: Schedule = { kind: 'unknown' };
    try {
      const { stdout } = await execFileAsync('plutil', [
        '-convert',
        'json',
        '-o',
        '-',
        path.join(launchAgentsDir, file),
      ]);
      schedule = parseSchedule(JSON.parse(stdout) as Record<string, unknown>);
    } catch {
      // Unreadable plist — still list the label so the user sees it exists.
    }
    out.push({ label: displayLabel(file), schedule });
  }

  out.sort((a, b) => scheduleRank(a.schedule) - scheduleRank(b.schedule));
  return out;
}

/**
 * Newest mtime among the files a run rewrites, falling back to the directory.
 * The directory mtime alone is a trap: rewriting a file in place leaves it
 * frozen at creation time, which made months-old dates show as "last run".
 */
export async function latestActivity(dir: string, dirFallback: Date): Promise<Date> {
  let newest: Date | null = null;
  for (const name of RUN_ARTIFACTS) {
    try {
      const stat = await fs.stat(path.join(dir, name));
      if (!newest || stat.mtime > newest) {
        newest = stat.mtime;
      }
    } catch {
      // Missing artifact — nothing to compare.
    }
  }
  // The directory mtime is a last resort, never a candidate: it is the very
  // value that goes stale, so an existing artifact always wins over it.
  return newest ?? dirFallback;
}

export async function readHistory(runsDir: string): Promise<HistoryRun[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    return [];
  }

  const out: HistoryRun[] = [];
  for (const label of entries) {
    const dir = path.join(runsDir, label);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }

    const runLog = await readTextIfExists(path.join(dir, 'run.log'));
    const result = await readTextIfExists(path.join(dir, 'result.txt'));
    const attemptsRaw = (await readTextIfExists(path.join(dir, 'attempts'))).trim();

    const exitMatch = [...runLog.matchAll(/exit=(\d+)/g)].pop();
    const doneMatch = [...runLog.matchAll(/=== done (.+?) exit=/g)].pop();
    let status: HistoryRun['status'] = 'pending';
    if (exitMatch) {
      status = exitMatch[1] === '0' ? 'ok' : 'fail';
    }

    out.push({
      label,
      status,
      attempts: attemptsRaw ? Number(attemptsRaw) || null : null,
      finishedAt: doneMatch ? doneMatch[1] : null,
      updatedAt: (await latestActivity(dir, stat.mtime)).toISOString(),
      logTail: runLog.trim() ? runLog.trim().split('\n').slice(-5) : [],
      resultPreview: result.slice(0, 500),
    });
  }

  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

// Read-only visibility into the night-shift orchestrator (launchd-scheduled
// Claude runs, see ~/.claude/skills/night-shift). This module only READS
// plists and run artifacts — scheduling stays with the orchestrator scripts.

const execFileAsync = promisify(execFile);
const router = express.Router();

const RUN_PREFIX = 'ru.tarariev.claude-run-';

type ScheduledRun = {
  label: string;
  hour: number | null;
  minute: number | null;
};

type HistoryRun = {
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

async function readScheduled(): Promise<ScheduledRun[]> {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const out: ScheduledRun[] = [];
  for (const file of files) {
    if (!file.startsWith(RUN_PREFIX) || !file.endsWith('.plist')) {
      continue;
    }
    const label = file.slice(RUN_PREFIX.length, -'.plist'.length);
    let hour: number | null = null;
    let minute: number | null = null;
    try {
      const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', path.join(dir, file)]);
      const json = JSON.parse(stdout) as Record<string, unknown>;
      const cal = json.StartCalendarInterval;
      const entry = (Array.isArray(cal) ? cal[0] : cal) as Record<string, unknown> | undefined;
      if (entry && typeof entry === 'object') {
        hour = typeof entry.Hour === 'number' ? entry.Hour : null;
        minute = typeof entry.Minute === 'number' ? entry.Minute : null;
      }
    } catch {
      // Unreadable plist — still list the label so the user sees it exists.
    }
    out.push({ label, hour, minute });
  }

  out.sort((a, b) => (a.hour ?? 99) * 60 + (a.minute ?? 0) - ((b.hour ?? 99) * 60 + (b.minute ?? 0)));
  return out;
}

async function readHistory(): Promise<HistoryRun[]> {
  const runsDir = path.join(os.homedir(), '.claude', 'night-shift', 'runs');
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
      updatedAt: stat.mtime.toISOString(),
      logTail: runLog.trim() ? runLog.trim().split('\n').slice(-5) : [],
      resultPreview: result.slice(0, 500),
    });
  }

  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

router.get('/', async (_req, res) => {
  const [scheduled, history] = await Promise.all([readScheduled(), readHistory()]);
  res.json({ success: true, scheduled, history });
});

export default router;

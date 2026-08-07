import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  latestActivity,
  parseSchedule,
  readHistory,
  readScheduled,
} from '@/modules/nightshift/nightshift.parser.js';

const darwinOnly = { skip: process.platform !== 'darwin' ? 'plutil is macOS-only' : false };

async function withTempDir(runTest: (dir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'neo3-nightshift-'));
  try {
    await runTest(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function plist(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${body}</dict></plist>`;
}

test('parseSchedule reads StartInterval jobs', () => {
  // The regression: every real watchdog plist uses StartInterval, and the
  // original parser only looked at StartCalendarInterval, so the UI showed "—".
  assert.deepEqual(parseSchedule({ StartInterval: 900 }), { kind: 'interval', seconds: 900 });
});

test('parseSchedule reads calendar jobs, defaulting the minute', () => {
  assert.deepEqual(parseSchedule({ StartCalendarInterval: { Hour: 9, Minute: 30 } }), {
    kind: 'daily',
    hour: 9,
    minute: 30,
  });
  assert.deepEqual(parseSchedule({ StartCalendarInterval: [{ Hour: 7 }] }), {
    kind: 'daily',
    hour: 7,
    minute: 0,
  });
});

test('parseSchedule reports unknown when the plist has neither key', () => {
  assert.deepEqual(parseSchedule({ RunAtLoad: true }), { kind: 'unknown' });
  assert.deepEqual(parseSchedule({ StartInterval: 0 }), { kind: 'unknown' });
});

test('readScheduled lists watchdog plists and ignores user schedules', darwinOnly, async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, 'ru.tarariev.claude-run-kill-idle-agents.plist'),
      plist('<key>StartInterval</key><integer>900</integer>')
    );
    // Predates the claude-run- convention but is the same kind of job.
    await writeFile(
      path.join(dir, 'ru.tarariev.mac-lifecycle.plist'),
      plist('<key>StartInterval</key><integer>300</integer>')
    );
    // Belongs to the Schedules panel — must never leak in here.
    await writeFile(
      path.join(dir, 'ru.tarariev.neo3-schedule-12.plist'),
      plist('<key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer></dict>')
    );
    // Unrelated bot of the user's.
    await writeFile(path.join(dir, 'ru.tarariev.wisper.plist'), plist('<key>RunAtLoad</key><true/>'));

    const scheduled = await readScheduled(dir);

    // Sorted by cadence: the 5-minute job before the 15-minute one.
    assert.deepEqual(
      scheduled.map((run) => run.label),
      ['mac-lifecycle', 'kill-idle-agents']
    );
    assert.deepEqual(scheduled[1].schedule, { kind: 'interval', seconds: 900 });
  });
});

test('latestActivity prefers rewritten artifacts over the stale directory mtime', async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, 'kill-idle-agents');
    await mkdir(dir);
    const log = path.join(dir, 'run.log');
    await writeFile(log, '=== done Thu Aug  6 14:47:17 MSK 2026 exit=0 ===\n');

    const stale = new Date('2026-07-10T09:01:00Z');
    const fresh = new Date('2026-08-06T11:47:00Z');
    await utimes(log, fresh, fresh);

    // schedule-run.sh rewrites files in place, so the directory mtime stays put.
    assert.equal((await latestActivity(dir, stale)).toISOString(), fresh.toISOString());
  });
});

test('readHistory reports the last run, not the day the folder was created', async () => {
  await withTempDir(async (root) => {
    const dir = path.join(root, 'kill-idle-agents');
    await mkdir(dir);
    await writeFile(
      path.join(dir, 'run.log'),
      [
        '=== fired Thu Jul  9 15:16:26 MSK 2026 attempt 1 ===',
        '=== done Thu Jul  9 15:16:26 MSK 2026 exit=0 ===',
        '=== fired Thu Aug  6 14:47:16 MSK 2026 attempt 2388 ===',
        '=== done Thu Aug  6 14:47:17 MSK 2026 exit=0 ===',
        '',
      ].join('\n')
    );
    await writeFile(path.join(dir, 'attempts'), '2388\n');
    await writeFile(path.join(dir, 'result.txt'), 'killed 0 idle agents');

    const fresh = new Date('2026-08-06T11:47:17Z');
    for (const name of ['run.log', 'attempts', 'result.txt']) {
      await utimes(path.join(dir, name), fresh, fresh);
    }

    const [run] = await readHistory(root);

    assert.equal(run.label, 'kill-idle-agents');
    assert.equal(run.status, 'ok');
    assert.equal(run.attempts, 2388);
    assert.equal(run.updatedAt, fresh.toISOString());
    assert.equal(run.finishedAt, 'Thu Aug  6 14:47:17 MSK 2026');
  });
});

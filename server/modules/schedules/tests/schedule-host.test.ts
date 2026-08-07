import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  SCHEDULE_LABEL_PREFIX,
  ScheduleHostUnsupportedError,
  createScheduleHost,
  getScheduleHost,
  isScheduleHostSupported,
  scheduleIdFromLabel,
  scheduleLabel,
  type ScheduleJob,
} from '@/modules/schedules/schedule-host.js';

type ExecCall = { file: string; args: string[] };

async function withTempDirs(
  runTest: (dirs: { dir: string; logDir: string }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'neo3-schedule-host-'));
  try {
    await runTest({ dir: path.join(root, 'units'), logDir: path.join(root, 'logs') });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function job(overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    label: scheduleLabel(7),
    hour: 9,
    minute: 5,
    weekdays: [],
    command: ['/usr/local/bin/node', '/apps/neo3/schedule-runner.js', '7'],
    environment: { PATH: '/usr/bin:/bin', DATABASE_PATH: '/home/dima/.cloudcli/auth.db' },
    description: 'Neo3 Agent System schedule: Morning report',
    ...overrides,
  };
}

function recorder(): { calls: ExecCall[]; exec: (file: string, args: string[]) => Promise<void> } {
  const calls: ExecCall[] = [];
  return {
    calls,
    exec: async (file, args) => {
      calls.push({ file, args });
    },
  };
}

test('scheduleLabel/scheduleIdFromLabel round-trip and reject foreign labels', () => {
  assert.equal(scheduleLabel(12), `${SCHEDULE_LABEL_PREFIX}12`);
  assert.equal(scheduleIdFromLabel(scheduleLabel(12)), 12);
  // The night-shift orchestrator owns this other prefix — it must never match.
  assert.equal(scheduleIdFromLabel('ru.tarariev.claude-run-nightly'), null);
});

test('launchd plist encodes a daily job without RunAtLoad', async () => {
  await withTempDirs(async ({ dir, logDir }) => {
    const { calls, exec } = recorder();
    const host = createScheduleHost('darwin', { dir, logDir, exec, activate: true });

    await host.create(job());

    const plist = await readFile(path.join(dir, `${scheduleLabel(7)}.plist`), 'utf8');
    assert.match(plist, /<key>Label<\/key>\s*<string>ru\.tarariev\.neo3-schedule-7<\/string>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<false\/>/);
    assert.match(plist, /<key>Hour<\/key><integer>9<\/integer><key>Minute<\/key><integer>5<\/integer>/);
    assert.ok(!plist.includes('<key>Weekday</key>'), 'a daily job must not pin a weekday');
    assert.match(plist, /<string>\/apps\/neo3\/schedule-runner\.js<\/string>/);
    assert.match(plist, /<key>DATABASE_PATH<\/key>/);

    assert.deepEqual(
      calls.map((call) => [call.file, call.args[0]]),
      [
        ['/bin/launchctl', 'bootout'],
        ['/bin/launchctl', 'bootstrap'],
      ]
    );
    assert.equal(calls[1].args[2], path.join(dir, `${scheduleLabel(7)}.plist`));
  });
});

test('launchd plist writes one calendar entry per weekday', async () => {
  await withTempDirs(async ({ dir, logDir }) => {
    const { exec } = recorder();
    const host = createScheduleHost('darwin', { dir, logDir, exec, activate: true });

    await host.create(job({ weekdays: [1, 3, 5] }));

    const plist = await readFile(path.join(dir, `${scheduleLabel(7)}.plist`), 'utf8');
    const weekdays = [...plist.matchAll(/<key>Weekday<\/key><integer>(\d)<\/integer>/g)].map((m) => m[1]);
    assert.deepEqual(weekdays, ['1', '3', '5']);
  });
});

test('launchd plist escapes XML in arguments', async () => {
  await withTempDirs(async ({ dir, logDir }) => {
    const { exec } = recorder();
    const host = createScheduleHost('darwin', { dir, logDir, exec, activate: true });

    await host.create(job({ command: ['/bin/node', '/tmp/a & b/runner.js', '7'] }));

    const plist = await readFile(path.join(dir, `${scheduleLabel(7)}.plist`), 'utf8');
    assert.match(plist, /<string>\/tmp\/a &amp; b\/runner\.js<\/string>/);
  });
});

test('launchd list() ignores night-shift plists and remove() boots the job out', async () => {
  await withTempDirs(async ({ dir, logDir }) => {
    const { calls, exec } = recorder();
    const host = createScheduleHost('darwin', { dir, logDir, exec, activate: true });

    await host.create(job());
    await host.create(job({ label: scheduleLabel(8) }));
    // The night-shift module reads plists with its own prefix from the same folder.
    await writeFile(path.join(dir, 'ru.tarariev.claude-run-nightly.plist'), '<plist/>', 'utf8');

    assert.deepEqual(await host.list(), [scheduleLabel(7), scheduleLabel(8)]);

    calls.length = 0;
    await host.remove(scheduleLabel(8));

    assert.deepEqual(await host.list(), [scheduleLabel(7)]);
    assert.deepEqual(calls, [
      { file: '/bin/launchctl', args: ['bootout', `gui/${process.getuid?.() ?? 501}/${scheduleLabel(8)}`] },
    ]);
  });
});

test('launchd remove() of a missing job is not an error', async () => {
  await withTempDirs(async ({ dir, logDir }) => {
    const host = createScheduleHost('darwin', {
      dir,
      logDir,
      exec: async () => {
        throw new Error('Boot-out failed: Could not find service');
      },
      activate: true,
    });

    await host.remove(scheduleLabel(99));
    assert.deepEqual(await host.list(), []);
  });
});

test('systemd writes a service+timer pair and enables the timer', async () => {
  await withTempDirs(async ({ dir, logDir }) => {
    const { calls, exec } = recorder();
    const host = createScheduleHost('linux', { dir, logDir, exec, activate: true });

    await host.create(job({ weekdays: [1, 3, 5] }));

    const service = await readFile(path.join(dir, `${scheduleLabel(7)}.service`), 'utf8');
    const timer = await readFile(path.join(dir, `${scheduleLabel(7)}.timer`), 'utf8');

    assert.match(service, /Type=oneshot/);
    assert.match(service, /Environment="DATABASE_PATH=\/home\/dima\/\.cloudcli\/auth\.db"/);
    assert.match(service, /ExecStart="\/usr\/local\/bin\/node" "\/apps\/neo3\/schedule-runner\.js" "7"/);
    assert.match(timer, /OnCalendar=Mon,Wed,Fri \*-\*-\* 09:05:00/);
    assert.match(timer, /Persistent=true/);
    assert.match(timer, /WantedBy=timers\.target/);

    assert.deepEqual(calls, [
      { file: 'systemctl', args: ['--user', 'daemon-reload'] },
      { file: 'systemctl', args: ['--user', 'enable', '--now', `${scheduleLabel(7)}.timer`] },
    ]);

    assert.deepEqual(await host.list(), [scheduleLabel(7)]);
  });
});

test('systemd daily timer omits the weekday prefix', async () => {
  await withTempDirs(async ({ dir, logDir }) => {
    const { exec } = recorder();
    const host = createScheduleHost('linux', { dir, logDir, exec, activate: true });

    await host.create(job({ hour: 23, minute: 0 }));

    const timer = await readFile(path.join(dir, `${scheduleLabel(7)}.timer`), 'utf8');
    assert.match(timer, /OnCalendar=\*-\*-\* 23:00:00/);
  });
});

test('systemd remove deletes both units', async () => {
  await withTempDirs(async ({ dir, logDir }) => {
    const { exec } = recorder();
    const host = createScheduleHost('linux', { dir, logDir, exec, activate: true });

    await host.create(job());
    await host.remove(scheduleLabel(7));

    assert.deepEqual(await host.list(), []);
    await assert.rejects(() => readFile(path.join(dir, `${scheduleLabel(7)}.service`), 'utf8'));
  });
});

test('an unsupported platform reports instead of throwing something opaque', () => {
  assert.throws(() => createScheduleHost('win32'), ScheduleHostUnsupportedError);
  assert.equal(isScheduleHostSupported('win32'), false);
  assert.equal(isScheduleHostSupported('darwin'), true);
  assert.equal(isScheduleHostSupported('linux'), true);
});

test('NEO3_SCHEDULE_DIR keeps units out of the real LaunchAgents folder', async () => {
  await withTempDirs(async ({ dir, logDir }) => {
    const previousDir = process.env.NEO3_SCHEDULE_DIR;
    const previousLogDir = process.env.NEO3_SCHEDULE_LOG_DIR;
    process.env.NEO3_SCHEDULE_DIR = dir;
    process.env.NEO3_SCHEDULE_LOG_DIR = logDir;

    try {
      if (!isScheduleHostSupported()) {
        assert.throws(() => getScheduleHost(), ScheduleHostUnsupportedError);
        return;
      }

      // With the directory overridden the host must not call launchctl/systemctl
      // either, so this create() touches nothing but the temp folder.
      await getScheduleHost().create(job());
      assert.deepEqual(await getScheduleHost().list(), [scheduleLabel(7)]);
      await getScheduleHost().remove(scheduleLabel(7));
      assert.deepEqual(await getScheduleHost().list(), []);
    } finally {
      if (previousDir === undefined) delete process.env.NEO3_SCHEDULE_DIR;
      else process.env.NEO3_SCHEDULE_DIR = previousDir;
      if (previousLogDir === undefined) delete process.env.NEO3_SCHEDULE_LOG_DIR;
      else process.env.NEO3_SCHEDULE_LOG_DIR = previousLogDir;
    }
  });
});

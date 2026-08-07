import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { schedulesDb } from '@/modules/database/repositories/schedules.db.js';
import { isScheduleHostSupported, scheduleLabel } from '@/modules/schedules/schedule-host.js';
import {
  createSchedule,
  deleteSchedule,
  formatWeekdays,
  listSchedules,
  normalizeScheduleInput,
  parseWeekdays,
  resolveRunnerCommand,
  runScheduleNow,
  setScheduleEnabled,
  updateSchedule,
} from '@/modules/schedules/schedules.service.js';

// server/openai-codex.js arms a module-level cleanup interval that is never
// unref'd, so the moment a test pulls in the engine dispatch the test process
// would stay alive forever. Unref'ing every interval created from here on keeps
// this file self-contained until that timer is fixed upstream.
const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = ((...args: Parameters<typeof originalSetInterval>) => {
  const timer = originalSetInterval(...args);
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
  return timer;
}) as typeof globalThis.setInterval;

const OWNER_PROJECT = '/tmp/neo3-schedules-owner-project';
const OTHER_PROJECT = '/tmp/neo3-schedules-other-project';

type Fixture = {
  owner: { id: number; role: string };
  stranger: { id: number; role: string };
  scheduleDir: string;
};

/**
 * Isolated database + an isolated unit directory. NEO3_SCHEDULE_DIR is what keeps
 * these tests away from the real ~/Library/LaunchAgents.
 */
async function withFixture(runTest: (fixture: Fixture) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousScheduleDir = process.env.NEO3_SCHEDULE_DIR;
  const previousLogDir = process.env.NEO3_SCHEDULE_LOG_DIR;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'schedules-service-'));
  const scheduleDir = path.join(tempDirectory, 'units');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.NEO3_SCHEDULE_DIR = scheduleDir;
  process.env.NEO3_SCHEDULE_LOG_DIR = path.join(tempDirectory, 'logs');
  await initializeDatabase();

  try {
    const owner = { id: Number(userDb.createUser('owner', 'hash').id), role: 'user' };
    const stranger = { id: Number(userDb.createUser('stranger', 'hash').id), role: 'user' };

    const ownerProject = projectsDb.createProjectPath(OWNER_PROJECT).project;
    projectsDb.createProjectPath(OTHER_PROJECT);
    userProjectAccessDb.grantAccess(owner.id, String(ownerProject?.project_id), null);

    await runTest({ owner, stranger, scheduleDir });
  } finally {
    closeConnection();
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('NEO3_SCHEDULE_DIR', previousScheduleDir);
    restoreEnv('NEO3_SCHEDULE_LOG_DIR', previousLogDir);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const hostTest = { skip: isScheduleHostSupported() ? false : 'host scheduler unsupported on this platform' };

// ---------------------------------------------------------------------------
// Pure validation
// ---------------------------------------------------------------------------

test('parseWeekdays sorts, de-duplicates and treats empty as daily', () => {
  assert.deepEqual(parseWeekdays(''), []);
  assert.deepEqual(parseWeekdays(null), []);
  assert.deepEqual(parseWeekdays('5,1,3,1'), [1, 3, 5]);
  assert.deepEqual(parseWeekdays([6, 0]), [0, 6]);
  assert.equal(formatWeekdays([1, 3, 5]), '1,3,5');
});

test('parseWeekdays rejects days outside 0..6', () => {
  assert.throws(() => parseWeekdays('7'), /weekdays/);
  assert.throws(() => parseWeekdays('-1'), /weekdays/);
  assert.throws(() => parseWeekdays('monday'), /weekdays/);
});

test('normalizeScheduleInput fills defaults and trims', () => {
  const normalized = normalizeScheduleInput({
    name: '  Morning report  ',
    projectPath: ' /workspace/app ',
    prompt: ' Summarise yesterday ',
    hour: '9',
    minute: '05',
    weekdays: '3,1',
  });

  assert.deepEqual(normalized, {
    name: 'Morning report',
    kind: 'prompt',
    projectPath: '/workspace/app',
    prompt: 'Summarise yesterday',
    pipelineId: null,
    hour: 9,
    minute: 5,
    weekdays: '1,3',
    enabled: true,
  });
});

test('normalizeScheduleInput accepts a pipeline schedule and drops prompt fields', () => {
  const normalized = normalizeScheduleInput({
    name: 'Nightly pipeline',
    kind: 'pipeline',
    pipelineId: '7',
    // Sent by a form that was switched from prompt to pipeline — must not stick.
    projectPath: '/workspace/app',
    prompt: 'ignored',
    hour: 3,
    minute: 0,
  });

  assert.deepEqual(normalized, {
    name: 'Nightly pipeline',
    kind: 'pipeline',
    projectPath: '',
    prompt: '',
    pipelineId: 7,
    hour: 3,
    minute: 0,
    weekdays: '',
    enabled: true,
  });
});

test('normalizeScheduleInput rejects incomplete or impossible input', () => {
  const valid = { name: 'x', projectPath: '/p', prompt: 'do it', hour: 9, minute: 0 };

  assert.throws(() => normalizeScheduleInput({ ...valid, name: '   ' }), /name is required/);
  assert.throws(() => normalizeScheduleInput({ ...valid, projectPath: '' }), /projectPath is required/);
  assert.throws(() => normalizeScheduleInput({ ...valid, prompt: '' }), /prompt is required/);
  assert.throws(() => normalizeScheduleInput({ ...valid, hour: 24 }), /hour/);
  assert.throws(() => normalizeScheduleInput({ ...valid, minute: -1 }), /minute/);
  assert.throws(() => normalizeScheduleInput({ ...valid, kind: 'webhook' }), /kind/);
  // kind=pipeline is valid now, but it is useless without something to start.
  assert.throws(() => normalizeScheduleInput({ ...valid, kind: 'pipeline' }), /pipelineId/);
});

test('resolveRunnerCommand runs plain node on a build and tsx in a checkout', () => {
  const built = resolveRunnerCommand(4, path.join('/apps', 'neo3', 'dist-server', 'server', 'modules', 'schedules'));
  assert.equal(built.length, 3);
  assert.equal(built[0], process.execPath);
  assert.match(built[1], /schedule-runner\.js$/);
  assert.equal(built[2], '4');

  const source = resolveRunnerCommand(4);
  assert.equal(source[0], process.execPath);
  assert.match(source[1], /tsx[/\\]dist[/\\]cli\.mjs$/);
  assert.equal(source[2], '--tsconfig');
  assert.match(source[3], /server[/\\]tsconfig\.json$/);
  assert.match(source[4], /schedule-runner\.js$/);
  assert.equal(source[5], '4');
});

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

test('a user cannot schedule a project they were not granted', async () => {
  await withFixture(async ({ owner }) => {
    await assert.rejects(
      () =>
        createSchedule(owner, {
          name: 'Steal',
          projectPath: OTHER_PROJECT,
          prompt: 'do it',
          hour: 3,
          minute: 0,
        }),
      /do not have access/
    );
    assert.deepEqual(listSchedules(owner), []);
  });
});

test('an unregistered project is refused rather than silently scheduled', async () => {
  await withFixture(async ({ owner }) => {
    await assert.rejects(
      () =>
        createSchedule(owner, {
          name: 'Ghost',
          projectPath: '/tmp/not-registered-anywhere',
          prompt: 'do it',
          hour: 3,
          minute: 0,
        }),
      /not registered/
    );
  });
});

test('a schedule is invisible and untouchable for anyone but its owner', hostTest, async () => {
  await withFixture(async ({ owner, stranger }) => {
    const created = await createSchedule(owner, {
      name: 'Nightly',
      projectPath: OWNER_PROJECT,
      prompt: 'do it',
      hour: 2,
      minute: 15,
    });

    assert.deepEqual(listSchedules(stranger), []);
    await assert.rejects(() => updateSchedule(stranger, created.id, { name: 'Hijacked' }), /not found/);
    await assert.rejects(() => setScheduleEnabled(stranger, created.id, false), /not found/);
    await assert.rejects(() => deleteSchedule(stranger, created.id), /not found/);

    assert.equal(schedulesDb.getById(created.id)?.name, 'Nightly');
  });
});

test('a run refuses once the owner loses access to the project', async () => {
  await withFixture(async ({ owner }) => {
    const row = schedulesDb.create({
      userId: owner.id,
      name: 'Nightly',
      projectPath: OTHER_PROJECT,
      prompt: 'do it',
      hour: 2,
      minute: 15,
    });

    await assert.rejects(() => runScheduleNow(row.id), /do not have access/);

    const stored = schedulesDb.getById(row.id);
    assert.match(String(stored?.last_status), /^error: /);
    assert.ok(stored?.last_run_at, 'a refused run is still recorded');
  });
});

test('a run of a schedule without a prompt is recorded as an error, not a crash', async () => {
  await withFixture(async ({ owner }) => {
    const row = schedulesDb.create({
      userId: owner.id,
      name: 'Broken',
      projectPath: OWNER_PROJECT,
      prompt: '',
      hour: 2,
      minute: 15,
    });

    await assert.rejects(() => runScheduleNow(row.id), /not runnable/);
    assert.match(String(schedulesDb.getById(row.id)?.last_status), /not runnable/);
  });
});

// ---------------------------------------------------------------------------
// Host synchronisation
// ---------------------------------------------------------------------------

test('creating a schedule writes a host unit and records its label', hostTest, async () => {
  await withFixture(async ({ owner, scheduleDir }) => {
    const created = await createSchedule(owner, {
      name: 'Nightly',
      projectPath: OWNER_PROJECT,
      prompt: 'do it',
      hour: 2,
      minute: 15,
      weekdays: '1,3,5',
    });

    assert.equal(created.osLabel, scheduleLabel(created.id));
    assert.deepEqual(created.weekdays, [1, 3, 5]);

    const files = await readdir(scheduleDir);
    assert.ok(
      files.some((file) => file.startsWith(scheduleLabel(created.id))),
      `expected a unit for ${scheduleLabel(created.id)} in ${files.join(', ')}`
    );
  });
});

test('disabling removes the host unit, re-enabling puts it back', hostTest, async () => {
  await withFixture(async ({ owner, scheduleDir }) => {
    const created = await createSchedule(owner, {
      name: 'Nightly',
      projectPath: OWNER_PROJECT,
      prompt: 'do it',
      hour: 2,
      minute: 15,
    });

    const disabled = await setScheduleEnabled(owner, created.id, false);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.osLabel, null);
    assert.deepEqual(await readdir(scheduleDir), []);

    const enabled = await setScheduleEnabled(owner, created.id, true);
    assert.equal(enabled.osLabel, scheduleLabel(created.id));
    assert.ok((await readdir(scheduleDir)).length > 0);
  });
});

test('deleting a schedule takes the host unit with it', hostTest, async () => {
  await withFixture(async ({ owner, scheduleDir }) => {
    const created = await createSchedule(owner, {
      name: 'Nightly',
      projectPath: OWNER_PROJECT,
      prompt: 'do it',
      hour: 2,
      minute: 15,
    });

    await deleteSchedule(owner, created.id);

    assert.equal(schedulesDb.getById(created.id), null);
    assert.deepEqual(await readdir(scheduleDir), []);
  });
});

test('updating rewrites the unit with the new time', hostTest, async () => {
  await withFixture(async ({ owner }) => {
    const created = await createSchedule(owner, {
      name: 'Nightly',
      projectPath: OWNER_PROJECT,
      prompt: 'do it',
      hour: 2,
      minute: 15,
    });

    const updated = await updateSchedule(owner, created.id, { hour: 23, minute: 45, weekdays: [0] });

    assert.equal(updated.hour, 23);
    assert.equal(updated.minute, 45);
    assert.deepEqual(updated.weekdays, [0]);
    assert.equal(updated.name, 'Nightly', 'fields left out of the patch keep their value');
  });
});

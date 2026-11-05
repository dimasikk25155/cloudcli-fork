import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  agentsDb,
  closeConnection,
  getConnection,
  initializeDatabase,
  projectsDb,
  schedulesDb,
  uiPreferencesDb,
  userDb,
} from '@/modules/database/index.js';
import { isScheduleHostSupported } from '@/modules/schedules/schedule-host.js';
import { createScheduleResultWatch, type ScheduleNotice } from '@/modules/schedules/schedule-result-watch.js';
import {
  AGENT_DELETED_STATUS,
  createSchedule,
  runScheduleNow,
  updateSchedule,
  type ScheduleRunDeps,
} from '@/modules/schedules/schedules.service.js';

type RunOptions = Parameters<NonNullable<ScheduleRunDeps['run']>>[0];

type World = {
  admin: { id: number; role: string };
  member: { id: number; role: string };
  agentProject: string;
  otherProject: string;
  calls: RunOptions[];
  deps: (answer?: string | Error) => ScheduleRunDeps;
};

async function withWorld(run: (world: World) => Promise<void>): Promise<void> {
  const previous = { db: process.env.DATABASE_PATH, dir: process.env.NEO3_SCHEDULE_DIR, logs: process.env.NEO3_SCHEDULE_LOG_DIR };
  const directory = await mkdtemp(path.join(tmpdir(), 'schedules-agent-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  // Keeps every unit away from the real ~/Library/LaunchAgents.
  process.env.NEO3_SCHEDULE_DIR = path.join(directory, 'units');
  process.env.NEO3_SCHEDULE_LOG_DIR = path.join(directory, 'logs');
  await initializeDatabase();
  try {
    const admin = { id: Number(userDb.createUserWithRole('dima', 'unused', 'admin').id), role: 'admin' };
    const member = { id: Number(userDb.createUserWithRole('slavik', 'unused', 'user').id), role: 'user' };
    const agentDir = path.join(directory, 'consigliere');
    const otherDir = path.join(directory, 'other');
    await mkdir(agentDir, { recursive: true });
    await mkdir(otherDir, { recursive: true });
    const agentProject = projectsDb.createProjectPath(agentDir).project!.project_path;
    const otherProject = projectsDb.createProjectPath(otherDir).project!.project_path;
    agentsDb.create({
      id: 'agent-brief', userId: admin.id, name: 'Брифер', role: 'Утренний бриф по криптоканалам',
      checks: '', provider: 'claude', model: 'sonnet[1m]', effort: 'low', projectPath: agentProject, files: [],
    });
    agentsDb.addRule('agent-brief', 'Не больше 10 пунктов', 'user');

    const calls: RunOptions[] = [];
    await run({
      admin, member, agentProject, otherProject, calls,
      deps: (answer = 'Бриф готов: BTC 101k') => ({
        run: async (options) => {
          calls.push(options);
          if (answer instanceof Error) throw answer;
          return { text: answer, sessionId: 'schedule-session-1' };
        },
        checkAccess: (_userId, projectPath) => ({ ok: true, projectPath }),
      }),
    });
  } finally {
    closeConnection();
    for (const [key, value] of [['DATABASE_PATH', previous.db], ['NEO3_SCHEDULE_DIR', previous.dir], ['NEO3_SCHEDULE_LOG_DIR', previous.logs]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

const hostTest = { skip: isScheduleHostSupported() ? false : 'host scheduler unsupported on this platform' };

function insertAgentSchedule(userId: number, extra: { notify?: boolean } = {}) {
  return schedulesDb.create({
    userId, name: 'Бриф', projectPath: null, prompt: 'Собери бриф за ночь', hour: 8, minute: 30,
    agentId: 'agent-brief', notify: extra.notify ?? false,
  });
}

// ---------------------------------------------------------------------------
// run as the agent
// ---------------------------------------------------------------------------

test('a schedule with an agent runs with its role, memory, engine, model, effort and folder', async () => {
  await withWorld(async ({ admin, agentProject, calls, deps }) => {
    const row = insertAgentSchedule(admin.id);
    const result = await runScheduleNow(row.id, deps('Бриф готов: BTC 101k\n' + 'x'.repeat(900)));

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.actor, 'schedule');
    assert.equal(call.provider, 'claude');
    assert.equal(call.model, 'sonnet[1m]');
    assert.equal(call.effort, 'low');
    assert.equal(call.projectPath, agentProject);
    assert.match(call.prompt, /^<agent_brief>[\s\S]*Брифер[\s\S]*Не больше 10 пунктов[\s\S]*<\/agent_brief>\n\nСобери бриф за ночь$/);

    assert.equal(result.status, 'ok');
    const stored = schedulesDb.getById(row.id)!;
    assert.equal(stored.last_status, 'ok');
    assert.equal(stored.last_result?.length, 600);
    assert.ok(stored.last_result?.startsWith('Бриф готов: BTC 101k'));
    assert.deepEqual(agentsDb.agentOfSession('schedule-session-1'), { id: 'agent-brief', name: 'Брифер', userId: admin.id });
  });
});

test('a schedule without an agent keeps the plain prompt and the user default engine', async () => {
  await withWorld(async ({ admin, otherProject, calls, deps }) => {
    const row = schedulesDb.create({ userId: admin.id, name: 'Plain', projectPath: otherProject, prompt: 'do it', hour: 1, minute: 0 });
    await runScheduleNow(row.id, deps('done'));
    assert.equal(calls[0].prompt, 'do it');
    assert.equal(calls[0].provider, undefined);
    assert.equal(calls[0].projectPath, otherProject);
    assert.equal(schedulesDb.getById(row.id)?.last_result, 'done');
  });
});

test('a deleted agent: status «агент удалён», no run', async () => {
  await withWorld(async ({ admin, calls, deps }) => {
    const row = insertAgentSchedule(admin.id);
    agentsDb.delete('agent-brief');
    await assert.rejects(() => runScheduleNow(row.id, deps()), (error: { code?: string }) => error.code === 'AGENT_DELETED');
    assert.equal(calls.length, 0);
    const stored = schedulesDb.getById(row.id)!;
    assert.equal(stored.last_status, AGENT_DELETED_STATUS);
    assert.equal(stored.last_result, AGENT_DELETED_STATUS);
    assert.ok(stored.last_run_at);
  });
});

test('an engine error is recorded as the result too', async () => {
  await withWorld(async ({ admin, deps }) => {
    const row = insertAgentSchedule(admin.id);
    await assert.rejects(() => runScheduleNow(row.id, deps(new Error('claude: usage limit'))), /usage limit/);
    const stored = schedulesDb.getById(row.id)!;
    assert.equal(stored.last_status, 'error: claude: usage limit');
    assert.equal(stored.last_result, 'claude: usage limit');
  });
});

test('«Агенты» switched off: an agent schedule does not run', async () => {
  await withWorld(async ({ admin, calls, deps }) => {
    const row = insertAgentSchedule(admin.id);
    uiPreferencesDb.updateUiPreferences(admin.id, { modAgents: false });
    await assert.rejects(() => runScheduleNow(row.id, deps()), (error: { code?: string }) => error.code === 'MOD_OFF');
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// «Прислать итог»
// ---------------------------------------------------------------------------

test('«Прислать итог»: one notice per run, errors included; notify off stays silent', async () => {
  await withWorld(async ({ admin, otherProject, deps }) => {
    const notices: ScheduleNotice[] = [];
    const watch = createScheduleResultWatch({ notify: (notice) => { notices.push(notice); } });
    const loud = insertAgentSchedule(admin.id, { notify: true });
    const quiet = schedulesDb.create({ userId: admin.id, name: 'Quiet', projectPath: otherProject, prompt: 'p', hour: 1, minute: 0 });

    assert.equal(await watch.tick(), 0, 'nothing ran yet');
    await runScheduleNow(loud.id, deps('Бриф: всё спокойно'));
    await runScheduleNow(quiet.id, deps('tihо'));

    assert.equal(await watch.tick(), 1);
    assert.deepEqual(notices[0], {
      code: 'schedule.result', userId: admin.id, scheduleId: loud.id,
      title: 'Расписание «Бриф»', body: 'Бриф: всё спокойно', ok: true,
    });
    assert.equal(await watch.tick(), 0, 'the same run is not sent twice');

    // The next run (the runner may have worked while the server was down).
    await runScheduleNow(loud.id, deps(new Error('нет сети'))).catch(() => undefined);
    getConnection().prepare("UPDATE schedules SET last_run_at = datetime(last_run_at, '+1 minute') WHERE id = ?").run(loud.id);
    assert.equal(await watch.tick(), 1);
    assert.equal(notices[1].body, 'Ошибка: нет сети');
    assert.equal(notices[1].ok, false);
  });
});

test('creating with an agent takes its folder; teammates and the mod switch are respected', hostTest, async () => {
  await withWorld(async ({ admin, member, agentProject, otherProject, deps }) => {
    const created = await createSchedule(admin, { name: 'Бриф', prompt: 'Собери бриф', hour: 8, minute: 30, agentId: 'agent-brief', notify: true });
    assert.equal(created.agentId, 'agent-brief');
    assert.equal(created.projectPath, agentProject);
    assert.equal(created.notify, true);
    assert.equal(created.lastResult, null);

    await assert.rejects(
      () => createSchedule(member, { name: 'x', prompt: 'p', hour: 1, minute: 0, agentId: 'agent-brief' }),
      (error: { code?: string }) => error.code === 'ADMIN_ONLY',
    );
    await assert.rejects(
      () => createSchedule(admin, { name: 'x', prompt: 'p', hour: 1, minute: 0, agentId: 'nobody' }),
      (error: { code?: string }) => error.code === 'AGENT_NOT_FOUND',
    );

    // Turning «Прислать итог» on later does not resend an old run.
    const plain = await createSchedule(admin, { name: 'Plain', projectPath: otherProject, prompt: 'p', hour: 1, minute: 0 });
    await runScheduleNow(plain.id, deps('old'));
    const switched = await updateSchedule(admin, plain.id, { notify: true });
    assert.equal(switched.notify, true);
    const notices: ScheduleNotice[] = [];
    await createScheduleResultWatch({ notify: (notice) => { notices.push(notice); } }).tick();
    assert.equal(notices.length, 0);

    uiPreferencesDb.updateUiPreferences(admin.id, { modAgents: false });
    await assert.rejects(
      () => createSchedule(admin, { name: 'y', prompt: 'p', hour: 1, minute: 0, agentId: 'agent-brief' }),
      (error: { code?: string }) => error.code === 'MOD_OFF',
    );
  });
});

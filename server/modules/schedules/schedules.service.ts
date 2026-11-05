/**
 * Schedules service — validation, host-scheduler sync and the actual run.
 *
 * How the OS reaches the app
 * --------------------------
 * launchd/systemd start a small node script (schedule-runner.js) instead of
 * curl-ing an HTTP endpoint. Two reasons:
 *   1. /api/schedules sits behind authenticateToken, so an HTTP trigger would
 *      need a second, key-authenticated entry point mounted in server/index.js —
 *      a new unauthenticated surface on a multi-user install.
 *   2. A schedule must fire after a reboot even when nobody has opened the web UI
 *      yet. The runner owns its own process and only needs the SQLite file, so it
 *      does not care whether the server is up.
 * The runner still goes through checkProjectAccess with the schedule owner's id,
 * so the fail-closed access rules are identical to the interactive path.
 */

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDatabasePath, pipelinesDb, schedulesDb, type ScheduleRow } from '@/modules/database/index.js';
import {
  ScheduleHostUnsupportedError,
  getScheduleHost,
  isScheduleHostSupported,
  scheduleLabel,
} from '@/modules/schedules/schedule-host.js';
import { isModOn as defaultIsModOn, modOffError, modOffMessage, type IsModOn } from '@/shared/mods.js';
import { AppError } from '@/shared/utils.js';
import { findAppRoot } from '@/utils/runtime-paths.js';

import { withAgentBrief } from '../../../shared/agent-brief.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loaded on demand rather than at module scope: the engine dispatch pulls in all
 * six CLI adapters, and one of them arms a module-level interval that keeps a
 * process alive. Nothing that merely lists or edits schedules should pay for
 * that — only an actual run does.
 */
function loadAgentRun() {
  return import('@/modules/agent-run/index.js');
}

/** The agent a schedule runs as — the slice of the agents service a run needs. */
export type ScheduleAgent = {
  id: string;
  name: string;
  provider: string;
  model: string;
  effort: string | null;
  projectPath: string;
};

export type ScheduleAgents = {
  /** Throws AppError AGENT_NOT_FOUND (deleted) or ADMIN_ONLY. */
  get(userId: number, agentId: string): ScheduleAgent;
  briefFor(userId: number, agentId: string): string;
};

/** Lazy for the same reason as the engine: listing schedules must stay light. */
async function loadAgents(): Promise<ScheduleAgents & { linkSession: (sessionId: string, agentId: string, userId: number) => void }> {
  const [{ agentsService }, { agentsDb }] = await Promise.all([
    import('@/modules/agents/index.js'),
    import('@/modules/database/index.js'),
  ]);
  return {
    get: (userId, agentId) => agentsService.get(userId, agentId),
    briefFor: (userId, agentId) => agentsService.briefFor(userId, agentId),
    linkSession: (sessionId, agentId, userId) => agentsDb.linkSession(sessionId, agentId, userId),
  };
}

/** Shown as the status of a schedule whose agent no longer exists. */
export const AGENT_DELETED_STATUS = 'агент удалён';
/** The result of a run kept for «Прислать итог». */
export const SCHEDULE_RESULT_MAX = 600;

function clipResult(text: string): string {
  const trimmed = String(text ?? '').trim();
  return trimmed.length > SCHEDULE_RESULT_MAX ? `${trimmed.slice(0, SCHEDULE_RESULT_MAX - 1).trimEnd()}…` : trimmed;
}

export type ScheduleActor = { id: number; role?: string };

export type ScheduleDto = {
  id: number;
  name: string;
  kind: string;
  projectPath: string | null;
  prompt: string;
  pipelineId: number | null;
  hour: number;
  minute: number;
  weekdays: number[];
  enabled: boolean;
  osLabel: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  /** Agent the run goes as; null — plain prompt with the user's default engine. */
  agentId: string | null;
  /** «Прислать итог»: push + Telegram after every run. */
  notify: boolean;
  /** ≤600 chars of the last answer, or the error text. */
  lastResult: string | null;
};

export function toScheduleDto(row: ScheduleRow): ScheduleDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    projectPath: row.project_path,
    prompt: row.prompt,
    pipelineId: row.pipeline_id,
    hour: row.hour,
    minute: row.minute,
    weekdays: parseWeekdays(row.weekdays),
    enabled: row.enabled === 1,
    osLabel: row.os_label,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    agentId: row.agent_id ?? null,
    notify: row.notify === 1,
    lastResult: row.last_result ?? null,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ScheduleInput = {
  name?: unknown;
  kind?: unknown;
  projectPath?: unknown;
  prompt?: unknown;
  pipelineId?: unknown;
  hour?: unknown;
  minute?: unknown;
  weekdays?: unknown;
  enabled?: unknown;
  /** Agent id; '' or null — no agent. With an agent the project is the agent's folder. */
  agentId?: unknown;
  notify?: unknown;
};

type NormalizedInput = {
  name: string;
  kind: 'prompt' | 'pipeline';
  projectPath: string;
  prompt: string;
  pipelineId: number | null;
  hour: number;
  minute: number;
  weekdays: string;
  enabled: boolean;
};

function badRequest(message: string): AppError {
  return new AppError(message, { code: 'SCHEDULE_INVALID', statusCode: 400 });
}

/** '' → every day. Accepts the stored string or an array coming from JSON. */
export function parseWeekdays(raw: unknown): number[] {
  const parts =
    Array.isArray(raw) ? raw : String(raw ?? '').split(',');

  const days: number[] = [];
  for (const part of parts) {
    const trimmed = String(part).trim();
    if (!trimmed) continue;
    const day = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw badRequest('weekdays must be numbers 0..6 (0 = Sunday)');
    }
    if (!days.includes(day)) days.push(day);
  }
  return days.sort((a, b) => a - b);
}

export function formatWeekdays(days: number[]): string {
  return days.join(',');
}

function readInt(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

/** '' / null / undefined → no agent. */
export function readAgentId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('agentId must be a string');
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeScheduleInput(input: ScheduleInput): NormalizedInput {
  const name = String(input.name ?? '').trim();
  if (!name) throw badRequest('name is required');
  if (name.length > 200) throw badRequest('name must be 200 characters or fewer');

  const kind = String(input.kind ?? 'prompt');
  if (kind !== 'prompt' && kind !== 'pipeline') {
    throw badRequest('kind must be "prompt" or "pipeline"');
  }

  // A pipeline carries its own project per step, so it needs neither a project
  // nor a prompt of its own — only the pipeline to start.
  // An agent brings its own folder, so a prompt schedule with an agent needs no project.
  const withAgent = kind === 'prompt' && readAgentId(input.agentId) !== null;
  const projectPath = kind === 'prompt' ? String(input.projectPath ?? '').trim() : '';
  if (kind === 'prompt' && !projectPath && !withAgent) throw badRequest('projectPath is required');

  const prompt = kind === 'prompt' ? String(input.prompt ?? '').trim() : '';
  if (kind === 'prompt' && !prompt) throw badRequest('prompt is required');

  let pipelineId: number | null = null;
  if (kind === 'pipeline') {
    pipelineId = readInt(input.pipelineId, 'pipelineId', 1, Number.MAX_SAFE_INTEGER);
  }

  return {
    name,
    kind,
    projectPath,
    prompt,
    pipelineId,
    hour: readInt(input.hour, 'hour', 0, 23),
    minute: readInt(input.minute, 'minute', 0, 59),
    weekdays: formatWeekdays(parseWeekdays(input.weekdays)),
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
  };
}

// ---------------------------------------------------------------------------
// Host sync
// ---------------------------------------------------------------------------

/**
 * argv the host scheduler must run. In a compiled install the runner is plain
 * JavaScript with the "@/" aliases already rewritten, so node runs it directly;
 * in a source checkout it still imports TypeScript, so it needs the same tsx
 * loader the dev server uses.
 */
export function resolveRunnerCommand(scheduleId: number, moduleDir: string = MODULE_DIR): string[] {
  const runnerPath = path.join(moduleDir, 'schedule-runner.js');

  if (moduleDir.split(path.sep).includes('dist-server')) {
    return [process.execPath, runnerPath, String(scheduleId)];
  }

  const appRoot = findAppRoot(moduleDir);
  return [
    process.execPath,
    path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    '--tsconfig',
    path.join(appRoot, 'server', 'tsconfig.json'),
    runnerPath,
    String(scheduleId),
  ];
}

/**
 * launchd and systemd start jobs with a stripped environment, so the few things
 * the runner cannot rediscover on its own are pinned at creation time.
 */
function runnerEnvironment(): Record<string, string> {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: os.homedir(),
    DATABASE_PATH: getDatabasePath(),
  };
}

function unsupportedPlatform(error: unknown): AppError {
  const message =
    error instanceof ScheduleHostUnsupportedError
      ? error.message
      : `Scheduling is not supported on this platform (${process.platform}).`;
  return new AppError(message, { code: 'SCHEDULE_HOST_UNSUPPORTED', statusCode: 501 });
}

/** Pushes the row's current state into the OS and records the resulting label. */
async function applyToHost(row: ScheduleRow): Promise<void> {
  let host;
  try {
    host = getScheduleHost();
  } catch (error) {
    throw unsupportedPlatform(error);
  }

  const label = scheduleLabel(row.id);

  if (row.enabled !== 1) {
    await host.remove(label);
    schedulesDb.setOsLabel(row.id, null);
    return;
  }

  await host.create({
    label,
    hour: row.hour,
    minute: row.minute,
    weekdays: parseWeekdays(row.weekdays),
    command: resolveRunnerCommand(row.id),
    environment: runnerEnvironment(),
    description: `Neo3 Agent System schedule: ${row.name}`,
  });
  schedulesDb.setOsLabel(row.id, label);
}

async function removeFromHost(row: ScheduleRow): Promise<void> {
  try {
    await getScheduleHost().remove(scheduleLabel(row.id));
  } catch {
    // Deleting a row must succeed even on a host that cannot schedule anything.
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Only the owner ever sees or edits a schedule — admins included. */
function loadOwned(actor: ScheduleActor, scheduleId: number): ScheduleRow {
  const row = schedulesDb.getById(scheduleId);
  if (!row || row.user_id !== Number(actor.id)) {
    throw new AppError('Schedule not found', { code: 'SCHEDULE_NOT_FOUND', statusCode: 404 });
  }
  return row;
}

async function assertProjectAccess(userId: number, projectPath: string): Promise<string> {
  const { checkProjectAccess } = await loadAgentRun();
  const access = checkProjectAccess(userId, projectPath);
  if (!access.ok) {
    throw new AppError(access.error, { code: 'PROJECT_ACCESS_DENIED', statusCode: 403 });
  }
  return access.projectPath;
}

/** Same fail-closed rule as schedules: a pipeline belongs to exactly one user. */
function assertPipelineAccess(userId: number, pipelineId: number | null): number {
  const pipeline = pipelineId === null ? null : pipelinesDb.getPipelineById(pipelineId);
  if (!pipeline || pipeline.user_id !== userId) {
    throw new AppError('Pipeline not found', { code: 'PIPELINE_NOT_FOUND', statusCode: 404 });
  }
  return pipeline.id;
}

/**
 * Both write paths resolve the same two targets, and each kind must leave the
 * other's column empty — otherwise a schedule switched from prompt to pipeline
 * would keep a stale project that no longer matches what it runs.
 */
/**
 * The agent of a prompt schedule: «Агенты» on, the user's own agent. A pipeline
 * runs its own steps, so it never keeps an agent.
 */
async function resolveAgent(
  userId: number,
  normalized: NormalizedInput,
  agentId: string | null,
  isModOn: IsModOn = defaultIsModOn
): Promise<string | null> {
  if (normalized.kind !== 'prompt' || agentId === null) return null;
  if (!isModOn(userId, 'modAgents')) throw modOffError('modAgents');
  const agent = (await loadAgents()).get(userId, agentId);
  normalized.projectPath = agent.projectPath;
  return agent.id;
}

async function resolveTarget(
  userId: number,
  normalized: NormalizedInput
): Promise<{ projectPath: string | null; prompt: string; pipelineId: number | null }> {
  if (normalized.kind === 'pipeline') {
    return { projectPath: null, prompt: '', pipelineId: assertPipelineAccess(userId, normalized.pipelineId) };
  }
  return {
    projectPath: await assertProjectAccess(userId, normalized.projectPath),
    prompt: normalized.prompt,
    pipelineId: null,
  };
}

export function listSchedules(actor: ScheduleActor): ScheduleDto[] {
  return schedulesDb.listByUser(Number(actor.id)).map(toScheduleDto);
}

export async function createSchedule(actor: ScheduleActor, input: ScheduleInput): Promise<ScheduleDto> {
  const normalized = normalizeScheduleInput(input);
  const agentId = await resolveAgent(Number(actor.id), normalized, readAgentId(input.agentId));
  const target = await resolveTarget(Number(actor.id), normalized);

  const row = schedulesDb.create({
    userId: Number(actor.id),
    name: normalized.name,
    kind: normalized.kind,
    projectPath: target.projectPath,
    prompt: target.prompt,
    pipelineId: target.pipelineId,
    hour: normalized.hour,
    minute: normalized.minute,
    weekdays: normalized.weekdays,
    enabled: normalized.enabled,
    agentId,
    notify: input.notify === true,
  });

  try {
    await applyToHost(row);
  } catch (error) {
    // A row the OS never accepted would silently never fire — drop it instead.
    schedulesDb.remove(row.id);
    throw error;
  }

  return toScheduleDto(schedulesDb.getById(row.id) ?? row);
}

export async function updateSchedule(
  actor: ScheduleActor,
  scheduleId: number,
  input: ScheduleInput
): Promise<ScheduleDto> {
  const existing = loadOwned(actor, scheduleId);
  const normalized = normalizeScheduleInput({
    name: input.name ?? existing.name,
    kind: input.kind ?? existing.kind,
    projectPath: input.projectPath ?? existing.project_path,
    prompt: input.prompt ?? existing.prompt,
    pipelineId: input.pipelineId ?? existing.pipeline_id,
    hour: input.hour ?? existing.hour,
    minute: input.minute ?? existing.minute,
    weekdays: input.weekdays ?? existing.weekdays,
    enabled: input.enabled ?? existing.enabled === 1,
    agentId: input.agentId === undefined ? existing.agent_id : input.agentId,
  });
  const agentId = await resolveAgent(
    Number(actor.id),
    normalized,
    readAgentId(input.agentId === undefined ? existing.agent_id : input.agentId)
  );
  const target = await resolveTarget(Number(actor.id), normalized);
  const notify = input.notify === undefined ? existing.notify === 1 : input.notify === true;

  const updated = schedulesDb.update(scheduleId, {
    name: normalized.name,
    kind: normalized.kind,
    projectPath: target.projectPath,
    prompt: target.prompt,
    pipelineId: target.pipelineId,
    hour: normalized.hour,
    minute: normalized.minute,
    weekdays: normalized.weekdays,
    enabled: normalized.enabled,
    agentId,
    notify,
  });
  if (updated && notify && existing.notify !== 1) {
    // Switching «Прислать итог» on must not re-send a run that happened before.
    schedulesDb.markNotified(scheduleId, existing.last_run_at);
  }
  if (!updated) {
    throw new AppError('Schedule not found', { code: 'SCHEDULE_NOT_FOUND', statusCode: 404 });
  }

  await applyToHost(updated);
  return toScheduleDto(schedulesDb.getById(scheduleId) ?? updated);
}

export async function setScheduleEnabled(
  actor: ScheduleActor,
  scheduleId: number,
  enabled: boolean
): Promise<ScheduleDto> {
  loadOwned(actor, scheduleId);
  const updated = schedulesDb.setEnabled(scheduleId, enabled);
  if (!updated) {
    throw new AppError('Schedule not found', { code: 'SCHEDULE_NOT_FOUND', statusCode: 404 });
  }
  await applyToHost(updated);
  return toScheduleDto(schedulesDb.getById(scheduleId) ?? updated);
}

export async function deleteSchedule(actor: ScheduleActor, scheduleId: number): Promise<void> {
  const row = loadOwned(actor, scheduleId);
  await removeFromHost(row);
  schedulesDb.remove(scheduleId);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type ScheduleRunResult = {
  scheduleId: number;
  status: 'ok' | 'error';
  text: string;
  sessionId: string | null;
};

/**
 * Starts the pipeline this schedule points at. Unlike a prompt run this returns
 * as soon as the run rows exist — a pipeline takes minutes and reports its own
 * progress in the Scenarios panel, so `last_status` here means "started", not
 * "finished".
 */
async function runPipelineSchedule(row: ScheduleRow): Promise<ScheduleRunResult> {
  if (!row.pipeline_id) {
    const message = 'Schedule is not runnable (no pipeline attached)';
    schedulesDb.markRun(row.id, `error: ${message}`, message);
    throw new AppError(message, { code: 'SCHEDULE_NOT_RUNNABLE', statusCode: 400 });
  }

  try {
    // Lazy for the same reason as the engine dispatch: the pipeline runner pulls
    // the CLI adapters in, and only an actual run should pay for that.
    // eslint-disable-next-line boundaries/dependencies -- pipelines has no barrel; lazy so the engines load only on a run
    const { pipelinesService } = await import('../pipelines/pipelines.service.js');
    const { runId } = await pipelinesService.startRun(row.user_id, row.pipeline_id, {
      trigger: 'schedule',
    });
    const text = `Запущен сценарий, прогон #${runId}`;
    schedulesDb.markRun(row.id, 'ok', text);
    return { scheduleId: row.id, status: 'ok', text, sessionId: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    schedulesDb.markRun(row.id, `error: ${message}`, clipResult(message));
    throw error;
  }
}

/** What a prompt run needs from outside; tests replace it, the runner uses the real thing. */
export type ScheduleRunDeps = {
  /** Shape of runHeadlessPrompt. */
  run?: (options: {
    projectPath: string;
    prompt: string;
    userId: number;
    actor: 'schedule';
    provider?: string;
    model?: string;
    effort?: string;
  }) => Promise<{ text?: string; sessionId?: string | null }>;
  checkAccess?: (userId: number, projectPath: string) => { ok: true; projectPath: string } | { ok: false; error: string };
  agents?: ScheduleAgents;
  linkSession?: (sessionId: string, agentId: string, userId: number) => void;
  isModOn?: IsModOn;
};

function refusedRun(row: ScheduleRow, status: string, message: string, code: string, statusCode: number): never {
  schedulesDb.markRun(row.id, status, clipResult(message));
  throw new AppError(message, { code, statusCode });
}

type PromptPlan = {
  projectPath: string;
  prompt: string;
  agent: ScheduleAgent | null;
};

/** With an agent: its folder, engine, model, effort and `<agent_brief>` in front of the prompt. */
async function planPromptRun(row: ScheduleRow, deps: ScheduleRunDeps): Promise<PromptPlan> {
  const projectPath = row.project_path ?? '';
  if (!row.agent_id) return { projectPath, prompt: row.prompt, agent: null };

  const isModOn = deps.isModOn ?? defaultIsModOn;
  if (!isModOn(row.user_id, 'modAgents')) {
    refusedRun(row, `error: ${modOffMessage('modAgents')}`, modOffMessage('modAgents'), 'MOD_OFF', 409);
  }
  const agents = deps.agents ?? (await loadAgents());
  let agent: ScheduleAgent;
  try {
    agent = agents.get(row.user_id, row.agent_id);
  } catch (error) {
    if ((error as { code?: string }).code === 'AGENT_NOT_FOUND') {
      refusedRun(row, AGENT_DELETED_STATUS, AGENT_DELETED_STATUS, 'AGENT_DELETED', 409);
    }
    const message = error instanceof Error ? error.message : String(error);
    refusedRun(row, `error: ${message}`, message, 'AGENT_UNAVAILABLE', 403);
  }
  const brief = agents.briefFor(row.user_id, agent.id);
  return { projectPath: agent.projectPath, prompt: withAgentBrief(brief, row.prompt), agent };
}

/**
 * Executes one schedule and records the outcome. Called both by the runner the
 * OS starts and by the "run now" button, so the access check is bound to the
 * schedule owner rather than to whoever triggered it. `last_result` keeps
 * ≤600 chars of the answer (or the error) for «Прислать итог».
 */
export async function runScheduleNow(scheduleId: number, deps: ScheduleRunDeps = {}): Promise<ScheduleRunResult> {
  const row = schedulesDb.getById(scheduleId);
  if (!row) {
    throw new AppError('Schedule not found', { code: 'SCHEDULE_NOT_FOUND', statusCode: 404 });
  }

  if (row.kind === 'pipeline') {
    return runPipelineSchedule(row);
  }

  if (row.kind !== 'prompt' || (!row.project_path && !row.agent_id) || !row.prompt.trim()) {
    const message = 'Schedule is not runnable (missing project or prompt)';
    refusedRun(row, `error: ${message}`, message, 'SCHEDULE_NOT_RUNNABLE', 400);
  }

  const plan = await planPromptRun(row, deps);
  const engine = deps.run && deps.checkAccess ? null : await loadAgentRun();
  const checkAccess = deps.checkAccess ?? engine!.checkProjectAccess;
  const run = deps.run ?? engine!.runHeadlessPrompt;

  const access = checkAccess(row.user_id, plan.projectPath);
  if (!access.ok) {
    refusedRun(row, `error: ${access.error}`, access.error, 'PROJECT_ACCESS_DENIED', 403);
  }

  try {
    const result = await run({
      projectPath: access.projectPath,
      prompt: plan.prompt,
      userId: row.user_id,
      actor: 'schedule',
      ...(plan.agent
        ? { provider: plan.agent.provider, model: plan.agent.model, ...(plan.agent.effort ? { effort: plan.agent.effort } : {}) }
        : {}),
    });
    const text = String(result?.text ?? '');
    const sessionId = result?.sessionId ?? null;
    if (plan.agent && sessionId) {
      try {
        const link = deps.linkSession ?? (deps.agents ? null : (await loadAgents()).linkSession);
        link?.(sessionId, plan.agent.id, row.user_id);
      } catch {
        // The sidebar label is a convenience; the run itself counts.
      }
    }
    schedulesDb.markRun(row.id, 'ok', clipResult(text) || null);
    return { scheduleId: row.id, status: 'ok', text, sessionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    schedulesDb.markRun(row.id, `error: ${message}`, clipResult(message));
    throw error;
  }
}

/** Manual trigger from the UI — same run, but only the owner may ask for it. */
export async function runScheduleForActor(actor: ScheduleActor, scheduleId: number): Promise<ScheduleRunResult> {
  const row = loadOwned(actor, scheduleId);
  return runScheduleNow(row.id);
}

export function getScheduleHostStatus(): { platform: NodeJS.Platform; supported: boolean } {
  return { platform: process.platform, supported: isScheduleHostSupported() };
}

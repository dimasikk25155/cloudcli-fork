/**
 * «Конвейер»: a queue of items (cards, files, tasks) an agent works through,
 * 1–3 executors at a time. Every task = the agent's `<agent_brief>` + the
 * template with `{{item}}` + the demand to end with a `ВЕРДИКТ` line.
 * FAIL is redone with the reason of the previous attempt until the attempt
 * limit, then the item goes to «брак». State lives in SQLite, so a restarted
 * server continues where it stopped (`recoverOnBoot`).
 *
 * Executors run through `runHeadlessPrompt` — always without approvals — so the
 * queue is admin-only and runs only in the agent's own folder. Every outside
 * effect (run, usage guard, notice, mod switch, agents) comes through deps.
 */

import { randomUUID } from 'node:crypto';

import {
  agentQueueDb,
  agentsDb,
  type AgentQueueCounts,
  type AgentQueueItemRow,
  type AgentQueueRow,
  type AgentQueueStatus,
} from '@/modules/database/index.js';
import { agentsService } from '@/modules/agents/index.js';
import { isModActive, isModOn as defaultIsModOn, type IsModOn } from '@/shared/mods.js';
import { isAdminUser } from '@/shared/project-access.js';
import { AppError } from '@/shared/utils.js';

import { withAgentBrief } from '../../../shared/agent-brief.js';
import { parseVerdict, VERDICT_INSTRUCTION, type QueueVerdict } from '../../../shared/queue-verdict.js';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const QUEUE_ITEMS_MAX = 500;
export const QUEUE_ITEM_MAX_CHARS = 2000;
export const QUEUE_TEMPLATE_MAX_CHARS = 8000;
export const QUEUE_TITLE_MAX = 120;
export const QUEUE_PARALLEL_MAX = 3;
export const QUEUE_ATTEMPTS_MAX = 4;
/** Queues with an executor in work at the same time, across all users. */
export const QUEUES_IN_WORK_MAX = 3;
export const QUEUE_ITEM_PLACEHOLDER = '{{item}}';
export const QUEUE_EXCERPT_MAX = 1000;
const REASON_MAX = 500;
export const AGENT_GONE_REASON = 'Агент удалён — пункт не выполнен';
export const RESTART_REASON = 'Прервано перезапуском сервера';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type QueueInput = {
  agentId?: unknown;
  title?: unknown;
  template?: unknown;
  /** One item per array entry, or one per line of a string. */
  items?: unknown;
  parallel?: unknown;
  maxAttempts?: unknown;
};

export type QueueItemView = {
  id: number;
  position: number;
  input: string;
  status: AgentQueueItemRow['status'];
  attempts: number;
  pass: number;
  verdict: 'ok' | 'fail' | null;
  reason: string | null;
  excerpt: string | null;
  sessionId: string | null;
  manual: boolean;
  updatedAt: string;
};

export type QueueSummary = {
  id: string;
  agentId: string;
  /** null — the agent was deleted. */
  agentName: string | null;
  title: string;
  template: string;
  parallel: number;
  maxAttempts: number;
  status: AgentQueueStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  counts: AgentQueueCounts;
};

export type QueueView = QueueSummary & { items: QueueItemView[] };

/** What one executor gets — the shape of `runHeadlessPrompt` options. */
export type QueueRunInput = {
  actor: 'queue';
  userId: number;
  provider: string;
  model: string;
  effort: string | null;
  projectPath: string;
  prompt: string;
};

export type QueueRunResult = { text: string; sessionId: string | null };

/** «Итог» of a finished queue, for push + Telegram. */
export type QueueNotice = {
  code: 'queue.done';
  userId: number;
  queueId: string;
  title: string;
  body: string;
};

type QueueAgent = { id: string; name: string; provider: string; model: string; effort: string | null; projectPath: string };

export type AgentQueueAgents = {
  /** The user's agent; throws AppError AGENT_NOT_FOUND / ADMIN_ONLY. */
  get(userId: number, agentId: string): QueueAgent;
  briefFor(userId: number, agentId: string): string;
};

export type AgentQueueDependencies = {
  run?: (input: QueueRunInput) => Promise<QueueRunResult>;
  /** Claude 5-hour guard; `blocked` → Claude executors wait. */
  checkUsageGuard?: () => Promise<{ blocked: boolean }>;
  notify?: (notice: QueueNotice) => void | Promise<void>;
  isModOn?: IsModOn;
  agents?: AgentQueueAgents;
  /** Marks an executor's chat as the agent's (sidebar label). */
  linkSession?: (sessionId: string, agentId: string, userId: number) => void;
  newId?: () => string;
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function refuse(code: string, message: string, statusCode: number): never {
  throw new AppError(message, { code, statusCode });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/** The end of the answer: the result and the verdict live there. */
function excerptOf(answer: string): string | null {
  const trimmed = answer.trim();
  if (!trimmed) return null;
  return trimmed.length > QUEUE_EXCERPT_MAX ? `…${trimmed.slice(-(QUEUE_EXCERPT_MAX - 1)).trimStart()}` : trimmed;
}

function readInt(value: unknown, fallback: number, min: number, max: number, message: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) refuse('QUEUE_INVALID', message, 400);
  return parsed;
}

function parseItems(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/) : [];
  const items = list.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
  if (items.length === 0) refuse('NO_ITEMS', 'Нет пунктов: впиши хотя бы один (по строке)', 400);
  if (items.length > QUEUE_ITEMS_MAX) refuse('TOO_MANY_ITEMS', `Не больше ${QUEUE_ITEMS_MAX} пунктов в одной очереди`, 400);
  const long = items.findIndex((item) => item.length > QUEUE_ITEM_MAX_CHARS);
  if (long >= 0) refuse('ITEM_TOO_LONG', `Пункт ${long + 1} длиннее ${QUEUE_ITEM_MAX_CHARS} знаков`, 400);
  return items;
}

/** A template without `{{item}}` gets the item at the end. */
export function normalizeTemplate(raw: unknown): string {
  const template = text(raw);
  if (template.length > QUEUE_TEMPLATE_MAX_CHARS) refuse('TEMPLATE_TOO_LONG', `Шаблон длиннее ${QUEUE_TEMPLATE_MAX_CHARS} знаков`, 400);
  if (template.includes(QUEUE_ITEM_PLACEHOLDER)) return template;
  return template ? `${template}\n\n${QUEUE_ITEM_PLACEHOLDER}` : QUEUE_ITEM_PLACEHOLDER;
}

/** The task of one attempt, without the brief. */
export function buildQueueTask(template: string, input: string, previousFail: string | null): string {
  const task = template.split(QUEUE_ITEM_PLACEHOLDER).join(input);
  const retry = previousFail
    ? `\n\nПрошлая попытка не прошла проверку: ${previousFail}. Исправь это в этой попытке.`
    : '';
  return `${task}${retry}${VERDICT_INSTRUCTION}`;
}

function itemView(row: AgentQueueItemRow): QueueItemView {
  const { queueId: _queueId, ...rest } = row;
  return rest;
}

async function defaultRun(input: QueueRunInput): Promise<QueueRunResult> {
  const { runHeadlessPrompt } = await import('@/modules/agent-run/index.js');
  const result = await runHeadlessPrompt({
    actor: input.actor,
    userId: input.userId,
    provider: input.provider,
    model: input.model,
    effort: input.effort ?? undefined,
    projectPath: input.projectPath,
    prompt: input.prompt,
  });
  return { text: String(result?.text ?? ''), sessionId: result?.sessionId ?? null };
}

async function defaultCheckUsageGuard(): Promise<{ blocked: boolean }> {
  const { checkUsageGuard } = await import('@/shared/claude-usage.js');
  return checkUsageGuard();
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createAgentQueueService(dependencies: AgentQueueDependencies = {}) {
  const run = dependencies.run ?? defaultRun;
  const checkUsageGuard = dependencies.checkUsageGuard ?? defaultCheckUsageGuard;
  const notify = dependencies.notify ?? (() => {});
  const isModOn = dependencies.isModOn ?? defaultIsModOn;
  const agents: AgentQueueAgents = dependencies.agents ?? agentsService;
  const linkSession = dependencies.linkSession ?? ((sessionId: string, agentId: string, userId: number) => {
    agentsDb.linkSession(sessionId, agentId, userId);
  });
  const newId = dependencies.newId ?? randomUUID;

  /** queueId → item ids whose executor is running in this process. */
  const inFlight = new Map<string, Set<number>>();
  const runs = new Set<Promise<void>>();
  let ticking = false;

  const queueOn = (userId: number) => isModActive(userId, 'modAgentQueue', isModOn);

  function requireAdmin(userId: number): void {
    if (!isAdminUser({ id: userId })) refuse('ADMIN_ONLY', 'Конвейер доступен только администратору', 403);
  }

  function ownQueue(userId: number, queueId: unknown): AgentQueueRow {
    requireAdmin(userId);
    const queue = typeof queueId === 'string' && queueId ? agentQueueDb.get(queueId) : null;
    if (!queue || queue.userId !== userId) refuse('QUEUE_NOT_FOUND', 'Такой очереди нет', 404);
    return queue;
  }

  function agentName(queue: AgentQueueRow): string | null {
    try {
      return agents.get(queue.userId, queue.agentId).name;
    } catch {
      return null;
    }
  }

  function summary(queue: AgentQueueRow): QueueSummary {
    return {
      id: queue.id,
      agentId: queue.agentId,
      agentName: agentName(queue),
      title: queue.title,
      template: queue.template,
      parallel: queue.parallel,
      maxAttempts: queue.maxAttempts,
      status: queue.status,
      createdAt: queue.createdAt,
      updatedAt: queue.updatedAt,
      finishedAt: queue.finishedAt,
      counts: agentQueueDb.counts(queue.id),
    };
  }

  function view(queueId: string): QueueView {
    const queue = agentQueueDb.get(queueId);
    if (!queue) refuse('QUEUE_NOT_FOUND', 'Такой очереди нет', 404);
    return { ...summary(queue), items: agentQueueDb.items(queueId).map(itemView) };
  }

  function busyCount(queueId: string): number {
    return inFlight.get(queueId)?.size ?? 0;
  }

  function queuesInWork(): number {
    let count = 0;
    for (const items of inFlight.values()) if (items.size > 0) count += 1;
    return count;
  }

  /** A running queue with nothing left → done + one «итог» (silent with the mod off). */
  async function finishIfDone(queueId: string): Promise<void> {
    const queue = agentQueueDb.get(queueId);
    if (!queue || queue.status !== 'running' || busyCount(queueId) > 0) return;
    const counts = agentQueueDb.counts(queueId);
    if (counts.pending > 0 || counts.running > 0) return;
    agentQueueDb.setStatus(queueId, 'done');
    if (!queueOn(queue.userId) || !agentQueueDb.markNotified(queueId)) return;
    try {
      await notify({
        code: 'queue.done',
        userId: queue.userId,
        queueId,
        title: `Конвейер «${queue.title}»`,
        body: `${counts.ok} OK, ${counts.rejected} брак`,
      });
    } catch (error) {
      console.error('[agent-queue] notice failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function attempt(queue: AgentQueueRow, agent: QueueAgent, item: AgentQueueItemRow, brief: string): Promise<void> {
    const previousFail = item.verdict === 'fail' && item.reason ? item.reason : null;
    const prompt = withAgentBrief(brief, buildQueueTask(queue.template, item.input, previousFail));
    let verdict: QueueVerdict;
    let answer = '';
    let sessionId: string | null = null;
    try {
      const result = await run({
        actor: 'queue',
        userId: queue.userId,
        provider: agent.provider,
        model: agent.model,
        effort: agent.effort,
        projectPath: agent.projectPath,
        prompt,
      });
      answer = String(result.text ?? '');
      sessionId = result.sessionId ?? null;
      verdict = parseVerdict(answer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      verdict = { verdict: 'fail', reason: `Сбой движка: ${message || 'без текста'}` };
    }

    if (sessionId) {
      try {
        linkSession(sessionId, agent.id, queue.userId);
      } catch {
        // The label in the sidebar is a convenience; the result counts anyway.
      }
    }

    const status = verdict.verdict === 'ok' ? 'ok' : item.attempts >= queue.maxAttempts ? 'rejected' : 'pending';
    agentQueueDb.finishAttempt(item.id, {
      status,
      verdict: verdict.verdict,
      reason: clip(verdict.reason, REASON_MAX),
      excerpt: excerptOf(answer),
      sessionId,
    });
  }

  function launch(queue: AgentQueueRow, agent: QueueAgent, item: AgentQueueItemRow, brief: string): void {
    const items = inFlight.get(queue.id) ?? new Set<number>();
    items.add(item.id);
    inFlight.set(queue.id, items);
    const job = attempt(queue, agent, item, brief)
      .catch((error) => {
        console.error('[agent-queue] attempt crashed', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        items.delete(item.id);
        if (items.size === 0) inFlight.delete(queue.id);
      })
      .then(() => finishIfDone(queue.id))
      .finally(() => {
        runs.delete(job);
      });
    runs.add(job);
  }

  // --- the tick ----------------------------------------------------------------

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      let claudeBlocked: Promise<boolean> | null = null;
      const isClaudeBlocked = () => {
        claudeBlocked ??= checkUsageGuard().then((guard) => Boolean(guard?.blocked)).catch(() => false);
        return claudeBlocked;
      };

      for (const listed of agentQueueDb.listByStatus('running')) {
        if (!queueOn(listed.userId)) {
          // Mod off: nothing new is taken, the queue waits on pause.
          agentQueueDb.setStatus(listed.id, 'paused');
          continue;
        }

        let agent: QueueAgent;
        try {
          agent = agents.get(listed.userId, listed.agentId);
        } catch (error) {
          if ((error as { code?: string }).code === 'AGENT_NOT_FOUND') {
            agentQueueDb.rejectPending(listed.id, AGENT_GONE_REASON);
            await finishIfDone(listed.id);
          } else {
            agentQueueDb.setStatus(listed.id, 'paused');
          }
          continue;
        }

        let free = listed.parallel - busyCount(listed.id);
        if (free <= 0) continue;
        if (busyCount(listed.id) === 0 && queuesInWork() >= QUEUES_IN_WORK_MAX) continue;
        if (agent.provider === 'claude' && (await isClaudeBlocked())) continue;

        // The await above may have let a pause or stop in.
        const queue = agentQueueDb.get(listed.id);
        if (!queue || queue.status !== 'running') continue;

        const brief = agents.briefFor(queue.userId, queue.agentId);
        while (free > 0) {
          const item = agentQueueDb.claimNext(queue.id);
          if (!item) break;
          launch(queue, agent, item, brief);
          free -= 1;
        }
        await finishIfDone(queue.id);
      }
    } finally {
      ticking = false;
    }
  }

  /** Resolves when every executor started so far has finished (tests, shutdown). */
  async function idle(): Promise<void> {
    while (runs.size > 0) {
      await Promise.allSettled([...runs]);
    }
  }

  /** At start-up: items left «в работе» by a dead process go back to the queue. */
  function recoverOnBoot(): number {
    return agentQueueDb.recoverRunning(RESTART_REASON);
  }

  // --- user actions -------------------------------------------------------------

  function create(userId: number, input: QueueInput): QueueView {
    requireAdmin(userId);
    const agentId = text(input.agentId);
    if (!agentId) refuse('AGENT_REQUIRED', 'Выбери агента для конвейера', 400);
    const agent = agents.get(userId, agentId);
    const items = parseItems(input.items);
    const template = normalizeTemplate(input.template);
    const parallel = readInt(input.parallel, 1, 1, QUEUE_PARALLEL_MAX, `Параллельно — от 1 до ${QUEUE_PARALLEL_MAX}`);
    const maxAttempts = readInt(input.maxAttempts, 2, 1, QUEUE_ATTEMPTS_MAX, `Попыток — от 1 до ${QUEUE_ATTEMPTS_MAX}`);
    const title = clip(text(input.title) || agent.name, QUEUE_TITLE_MAX);
    const queue = agentQueueDb.create({ id: newId(), userId, agentId: agent.id, title, template, parallel, maxAttempts, items });
    return view(queue.id);
  }

  function list(userId: number): QueueSummary[] {
    requireAdmin(userId);
    return agentQueueDb.listByUser(userId).map(summary);
  }

  function get(userId: number, queueId: string): QueueView {
    return view(ownQueue(userId, queueId).id);
  }

  function stateRefusal(queue: AgentQueueRow, action: string): never {
    const label: Record<AgentQueueStatus, string> = {
      running: 'уже идёт',
      paused: 'на паузе',
      stopped: 'остановлена',
      done: 'закончена',
    };
    refuse('QUEUE_STATE', `Нельзя ${action}: очередь ${label[queue.status]}`, 409);
  }

  function pause(userId: number, queueId: string): QueueView {
    const queue = ownQueue(userId, queueId);
    if (queue.status !== 'running') stateRefusal(queue, 'поставить на паузу');
    agentQueueDb.setStatus(queue.id, 'paused');
    return view(queue.id);
  }

  function resume(userId: number, queueId: string): QueueView {
    const queue = ownQueue(userId, queueId);
    if (queue.status !== 'paused') stateRefusal(queue, 'продолжить');
    agentQueueDb.setStatus(queue.id, 'running');
    return view(queue.id);
  }

  /** Final: nothing new is taken; executors already in work finish and are recorded. */
  function stop(userId: number, queueId: string): QueueView {
    const queue = ownQueue(userId, queueId);
    if (queue.status !== 'running' && queue.status !== 'paused') stateRefusal(queue, 'остановить');
    agentQueueDb.setStatus(queue.id, 'stopped');
    return view(queue.id);
  }

  /** «Ещё проход»: брак → back in the queue with a fresh attempt counter (pass + 1). */
  function retryRejected(userId: number, queueId: string): QueueView {
    const queue = ownQueue(userId, queueId);
    if (queue.status === 'stopped') stateRefusal(queue, 'запустить ещё проход');
    if (agentQueueDb.retryRejected(queue.id) === 0) refuse('NO_REJECTED', 'Брака нет — переделывать нечего', 409);
    if (queue.status === 'done') agentQueueDb.setStatus(queue.id, 'running');
    return view(queue.id);
  }

  /** Hand-checked OK of a «брак» (or a FAIL waiting for its next attempt). */
  async function markOk(userId: number, itemId: unknown): Promise<QueueView> {
    requireAdmin(userId);
    const id = Number(itemId);
    const item = Number.isSafeInteger(id) ? agentQueueDb.item(id) : null;
    const queue = item ? agentQueueDb.get(item.queueId) : null;
    if (!item || !queue || queue.userId !== userId) refuse('ITEM_NOT_FOUND', 'Такого пункта нет', 404);
    if (!agentQueueDb.markOk(item.id)) refuse('ITEM_STATE', 'Отметить OK можно только брак или пункт, ждущий переделки', 409);
    await finishIfDone(queue.id);
    return view(queue.id);
  }

  function remove(userId: number, queueId: string): void {
    const queue = ownQueue(userId, queueId);
    agentQueueDb.delete(queue.id);
  }

  return {
    create,
    list,
    get,
    pause,
    resume,
    stop,
    retryRejected,
    markOk,
    remove,
    tick,
    idle,
    recoverOnBoot,
  };
}

export type AgentQueueService = ReturnType<typeof createAgentQueueService>;

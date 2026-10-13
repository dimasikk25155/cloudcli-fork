/**
 * Auto-relay («Авто-перенос»): when a chat with the switch on has grown past
 * the relay threshold, the server moves it to a continuation chat by itself —
 * no open tab needed.
 *
 *   turn ended (attention `done`), threshold of shared/relay-rules reached,
 *   nothing running, no open threads, no background tasks
 *     → the relay request goes into the chat (state `collecting`)
 *   that turn ended with `HANDOFF_FILE: <path>`
 *     → the note is checked (relay-file rule) → a continuation chat is created
 *       on the same engine/model/effort, linked as `relay`, and started with
 *       «Прочитай <путь> и продолжай работу с того места» (state `done`)
 *   no note → told once (push + band), the switch goes off (state `failed`)
 *
 * Loops are impossible by construction: one move per chat (`done` is final),
 * the continuation inherits the switch but starts idle and moves only past its
 * own threshold, a failure turns the switch off. Runs go through the chat
 * gateway like typed messages (`auto-relay` access: same user, same project);
 * Claude runs obey the 5-hour guard, local models do not spend it.
 */

import { mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import {
  sessionAttentionDb,
  sessionAutoRelayDb,
  sessionLinksDb,
  sessionsDb,
  sessionThreadsDb,
  uiPreferencesDb,
  type AutoRelayState,
  type SessionAutoRelayRow,
} from '@/modules/database/index.js';
import { resolveRelayFile } from '@/modules/relay/relay-file.service.js';
import { assertCanLinkNewChild, linkSession } from '@/modules/session-links/index.js';
import { canAccessSession, projectIdOfSession } from '@/shared/project-access.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { lastReplyTurn, type ReplyTurnMessage } from '../../../shared/reply-turn.js';
import {
  buildRelayFirstMessage,
  buildRelayRequest,
  DEFAULT_RELAY_THRESHOLDS,
  findHandoffAfterRequest,
  hasHumanMessageAfterRequest,
  isRelayRequestText,
  relayMeasures,
  relayRequestTag,
  relaySuggestion,
  type RelayDismissal,
  type RelayThresholds,
} from '../../../shared/relay-rules.js';
import { lastRunOptions } from './run-options.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AutoRelayStatus = {
  sessionId: string;
  enabled: boolean;
  state: AutoRelayState | null;
  childSessionId: string | null;
  childTitle: string | null;
  error: string | null;
  /** The move was started by «Перенести» (the switch may be off). */
  manual: boolean;
};

/** One run the auto-relay asks the chat gateway to start. */
export type AutoRelayRunStart = {
  sessionId: string;
  userId: number;
  /** The chat being moved (the target itself, or its new continuation). */
  parentSessionId: string;
  content: string;
  options: Record<string, unknown>;
};

/** The chat gateway's side: same run registry, indicator and Stop as a typed message. */
export type AutoRelayRunControl = {
  /** True when the run was registered and started. */
  start(input: AutoRelayRunStart): boolean;
  /** Live background tasks of the chat (Claude); 0 when none or unknown. */
  backgroundTaskCount(sessionId: string): number;
};

export type AutoRelayAttention = { state: string; reason?: string | null };

/** The slice of a session-attention change this module reads. */
export type AutoRelayChange = {
  sessionId: string;
  userId: number | null;
  state: string;
  reason?: string | null;
};

export type AutoRelayNotice =
  | { kind: 'done'; userId: number; provider: string; sessionId: string; childSessionId: string; childTitle: string }
  | { kind: 'failed'; userId: number; provider: string; sessionId: string; error: string };

export type AutoRelayDependencies = {
  now?: () => Date;
  isProcessing?: (sessionId: string) => boolean;
  attentionOf?: (sessionId: string) => AutoRelayAttention | null;
  fetchMessages?: (sessionId: string) => Promise<ReplyTurnMessage[]>;
  /** Latest occupied context of the chat's last run (token_budget `used`) and its model. */
  usageOf?: (sessionId: string) => { usedTokens: number | null; model: string | null };
  /** Selected model's window from the backend catalog; null = unknown. */
  contextWindowOf?: (provider: string, model: string | null) => Promise<number | null>;
  /** Claude 5-hour guard; fails open (an unknown usage never blocks). */
  checkClaudeLimit?: () => Promise<{ blocked: boolean; notice?: string }>;
  /** «Авто-перенос в новых чатах» of a user. */
  newChatsDefault?: (userId: number) => boolean;
  /** Push «Перенёс в новый чат» / «Авто-перенос не получился». */
  notify?: (notice: AutoRelayNotice) => void;
  /** WS frame to every socket that may see the chat's project. */
  broadcast?: (payload: Record<string, unknown>, projectId: string | null) => void;
  /** Re-sends sidebar cards (new continuation, parent's «→ продолжен в»). */
  broadcastUpsert?: (sessionId: string) => void;
  /** «Ждут тебя»: the moved chat is not news any more. */
  markSeen?: (userId: number, sessionId: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** One-shot timer; returns its cancel. */
  setTimer?: (fire: () => void, ms: number) => () => void;
  /** How long the handoff turn may take before the move is given up. */
  collectingTimeoutMs?: number;
  thresholds?: RelayThresholds;
  nonce?: () => string;
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const TITLE_MAX = 60;
const ERROR_MAX = 300;
/** Engines whose transcript can lag the `complete` by a moment. */
const HISTORY_ATTEMPTS = 4;
const HISTORY_RETRY_MS = 1500;
/** Mid-run requests (the run is paused on them) — the human answers, the turn goes on. */
const MID_RUN_REASONS = new Set(['ask', 'plan', 'permission']);
/** The handoff turn's budget; past it the move is given up with a clear error. */
export const COLLECTING_TIMEOUT_MS = 10 * 60 * 1000;
export const LOCAL_MODELS = ['local-qwen35-9b', 'local-ornith-9b'] as const;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function isLocalModel(model: unknown): boolean {
  return typeof model === 'string' && (LOCAL_MODELS as readonly string[]).includes(model);
}

function randomNonce(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

/**
 * Test hook for live checks: a smaller token threshold through the env, the
 * defaults stay the rule. Ignored unless it is a positive number.
 */
export function thresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): RelayThresholds {
  const tokens = Number(env.NEO3_AUTO_RELAY_TOKENS);
  return Number.isFinite(tokens) && tokens > 0
    ? { ...DEFAULT_RELAY_THRESHOLDS, contextTokens: tokens }
    : { ...DEFAULT_RELAY_THRESHOLDS };
}

async function defaultFetchMessages(sessionId: string): Promise<ReplyTurnMessage[]> {
  const { sessionsService } = await import('@/modules/providers/services/sessions.service.js');
  const history = await sessionsService.fetchHistory(sessionId, { limit: 60, offset: 0 });
  return history.messages as ReplyTurnMessage[];
}

async function defaultCheckClaudeLimit(): Promise<{ blocked: boolean; notice?: string }> {
  try {
    const { checkUsageGuard, buildUsageGuardNotice } = await import('@/shared/claude-usage.js');
    const guard = await checkUsageGuard();
    return guard.blocked ? { blocked: true, notice: buildUsageGuardNotice(guard) } : { blocked: false };
  } catch {
    return { blocked: false };
  }
}

async function defaultContextWindowOf(provider: string, model: string | null): Promise<number | null> {
  if (!model) return null;
  try {
    const { providerModelsService } = await import('@/modules/providers/services/provider-models.service.js');
    const result = await providerModelsService.getProviderModels(provider as LLMProvider);
    const option = (result.models?.OPTIONS ?? []).find((entry: { value: string }) => entry.value === model) as
      | { contextWindow?: number }
      | undefined;
    return typeof option?.contextWindow === 'number' && option.contextWindow > 0 ? option.contextWindow : null;
  } catch {
    return null;
  }
}

function defaultAttentionOf(sessionId: string): AutoRelayAttention | null {
  const row = sessionAttentionDb.get(sessionId);
  return row ? { state: row.state, reason: row.reason } : null;
}

function defaultNewChatsDefault(userId: number): boolean {
  return uiPreferencesDb.getUiPreferences(userId).autoRelayNewChats === true;
}

function sessionTitle(sessionId: string): string | null {
  return sessionsDb.getSessionById(sessionId)?.custom_name?.trim() || null;
}

/**
 * Creates `<project>/docs/handoff/` so the handoff turn needs no terminal
 * command (in default mode that would stop on approval) — only when the
 * folder lands inside the project. Best effort: the agent can still create it.
 */
function prepareNoteFolder(projectPath: string): void {
  try {
    const folder = path.join(projectPath, 'docs', 'handoff');
    mkdirSync(folder, { recursive: true });
    const relative = path.relative(realpathSync(projectPath), realpathSync(folder));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      console.warn('[AutoRelay] docs/handoff leads out of the project', { projectPath });
    }
  } catch (error) {
    console.warn('[AutoRelay] note folder not prepared', { projectPath, error: error instanceof Error ? error.message : String(error) });
  }
}

/** A stored floor counts only with a known spend: an unknown one would let the continuation move at once. */
function readBaseline(row: SessionAutoRelayRow | null): RelayDismissal | null {
  if (!row?.baseline_json) return null;
  try {
    const parsed = JSON.parse(row.baseline_json) as Partial<RelayDismissal>;
    const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    const floor = { usedTokens: num(parsed.usedTokens), contextPercent: num(parsed.contextPercent), ageHours: num(parsed.ageHours) };
    return floor.usedTokens === null ? null : floor;
  } catch {
    return null;
  }
}

function toStatus(sessionId: string, row: SessionAutoRelayRow | null): AutoRelayStatus {
  const childSessionId = row?.child_session_id ?? null;
  return {
    sessionId,
    enabled: Boolean(row?.enabled),
    state: row?.state ?? null,
    childSessionId,
    childTitle: childSessionId ? sessionTitle(childSessionId) : null,
    error: row?.error ?? null,
    manual: Boolean(row?.manual),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createAutoRelayService(dependencies: AutoRelayDependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const attentionOf = dependencies.attentionOf ?? defaultAttentionOf;
  const fetchMessages = dependencies.fetchMessages ?? defaultFetchMessages;
  const checkClaudeLimit = dependencies.checkClaudeLimit ?? defaultCheckClaudeLimit;
  const contextWindowOf = dependencies.contextWindowOf ?? defaultContextWindowOf;
  const newChatsDefault = dependencies.newChatsDefault ?? defaultNewChatsDefault;
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const thresholds = dependencies.thresholds ?? thresholdsFromEnv();
  const collectingTimeoutMs = dependencies.collectingTimeoutMs ?? COLLECTING_TIMEOUT_MS;
  const setTimer = dependencies.setTimer ?? ((fire: () => void, ms: number) => {
    const timer = setTimeout(fire, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  });
  const nonce = dependencies.nonce ?? randomNonce;
  const notify = dependencies.notify ?? ((notice: AutoRelayNotice) => {
    void import('./auto-relay.notify.js')
      .then(({ pushAutoRelayNotice }) => pushAutoRelayNotice(notice))
      .catch((error: unknown) => console.error('[AutoRelay] push failed', { error: (error as Error)?.message }));
  });
  const broadcast = dependencies.broadcast ?? ((payload: Record<string, unknown>, projectId: string | null) => {
    void import('@/modules/websocket/services/project-access.service.js')
      .then(({ broadcastProjectEvent }) => broadcastProjectEvent(JSON.stringify(payload), projectId))
      .catch((error: unknown) => console.error('[AutoRelay] broadcast failed', { error: (error as Error)?.message }));
  });
  const broadcastUpsert = dependencies.broadcastUpsert ?? ((sessionId: string) => {
    void import('@/modules/websocket/services/chat-run-registry.service.js')
      .then(({ chatRunRegistry }) => chatRunRegistry.broadcastSessionUpsert(sessionId))
      .catch(() => {});
  });
  const markSeen = dependencies.markSeen ?? ((userId: number, sessionId: string) => {
    void import('@/modules/session-attention/session-attention.service.js')
      .then(({ sessionAttention }) => sessionAttention.markSeen({ id: userId }, { sessionIds: [sessionId] }))
      .catch(() => {});
  });

  // The registry is loaded lazily (it imports this module's neighbours); tests inject their own.
  let registry: {
    isProcessing: (sessionId: string) => boolean;
    usageOf: (sessionId: string) => { usedTokens: number | null; model: string | null };
  } | null = null;
  const ensureRegistry = async (): Promise<void> => {
    if (registry || (dependencies.isProcessing && dependencies.usageOf)) return;
    const { chatRunRegistry } = await import('@/modules/websocket/services/chat-run-registry.service.js');
    registry = {
      isProcessing: (sessionId) => chatRunRegistry.isProcessing(sessionId),
      usageOf: (sessionId) => chatRunRegistry.lastContextUsage(sessionId),
    };
  };
  const isProcessing = (sessionId: string): boolean =>
    dependencies.isProcessing ? dependencies.isProcessing(sessionId) : (registry?.isProcessing(sessionId) ?? false);
  const usageOf = (sessionId: string) =>
    dependencies.usageOf ? dependencies.usageOf(sessionId) : (registry?.usageOf(sessionId) ?? { usedTokens: null, model: null });

  let runControl: AutoRelayRunControl | null = null;
  /** Chats a step is being taken for right now (one at a time per chat). */
  const busy = new Set<string>();
  /** Changes that arrived while busy: the chat is looked at again afterwards. */
  const again = new Map<string, AutoRelayChange>();

  const stamp = () => now().toISOString();
  /** Timeouts of handoff turns in progress, by chat. */
  const collectingTimers = new Map<string, () => void>();

  function clearCollectingTimer(sessionId: string): void {
    collectingTimers.get(sessionId)?.();
    collectingTimers.delete(sessionId);
  }

  function emit(sessionId: string): void {
    const status = toStatus(sessionId, sessionAutoRelayDb.get(sessionId));
    broadcast({ kind: 'auto_relay', sessionId, status, timestamp: stamp() }, projectIdOfSession(sessionId));
  }

  /** Engine options for an automatic run: the chat's last typed run, else its stored model/effort. */
  function runOptionsFor(sessionId: string): Record<string, unknown> {
    const options = lastRunOptions(sessionId) ?? {};
    const row = sessionsDb.getSessionById(sessionId);
    if (!options.model && row?.model) options.model = row.model;
    if (!options.effort && row?.effort) options.effort = row.effort;
    // Plan mode cannot write the note; the automatic turns run as typed ones otherwise.
    if (options.permissionMode === 'plan') delete options.permissionMode;
    if (isLocalModel(options.model)) options.usageGuardOverride = true;
    return options;
  }

  /** Any open thread: working, asking, or with results the parent has not received yet. */
  function hasOpenThreads(sessionId: string): boolean {
    return sessionThreadsDb.listByParent(sessionId).some((thread) =>
      isProcessing(thread.thread_session_id)
      || attentionOf(thread.thread_session_id)?.state === 'waiting'
      || (thread.seen_at === null && thread.notified_at === null));
  }

  function hasRelayChild(sessionId: string): boolean {
    return sessionLinksDb.getChildren([sessionId]).some((child) => child.relation === 'relay');
  }

  async function readMessages(sessionId: string, tag: string): Promise<ReplyTurnMessage[]> {
    let messages: ReplyTurnMessage[] = [];
    for (let attempt = 0; attempt < HISTORY_ATTEMPTS; attempt += 1) {
      messages = await fetchMessages(sessionId);
      if (findHandoffAfterRequest(messages, tag)) return messages;
      if (attempt < HISTORY_ATTEMPTS - 1) await sleep(HISTORY_RETRY_MS);
    }
    return messages;
  }

  /**
   * Gives the move up — only from a move in progress, atomically: whoever
   * wins (end of turn, timeout, boot) tells it, everyone else does nothing.
   */
  function fail(sessionId: string, row: SessionAutoRelayRow, error: string): boolean {
    // A move by «Перенести» leaves the switch as it was; the switch's own move turns it off.
    const manual = Boolean(sessionAutoRelayDb.get(sessionId)?.manual ?? row.manual);
    const text = clip(manual ? error : `${error} Авто-перенос выключен.`, ERROR_MAX);
    const patch: Parameters<typeof sessionAutoRelayDb.transition>[2] = manual
      ? { state: 'failed', error: text }
      : { state: 'failed', enabled: 0, error: text };
    if (!sessionAutoRelayDb.transition(sessionId, ['collecting', 'creating'], patch, stamp())) {
      return false;
    }
    clearCollectingTimer(sessionId);
    emit(sessionId);
    const userId = row.user_id;
    const provider = sessionsDb.getSessionById(sessionId)?.provider ?? 'claude';
    if (userId !== null) notify({ kind: 'failed', userId, provider, sessionId, error: text });
    return true;
  }

  /** Dima took the chat back (a run of his, or his message after the request): the move stands down. */
  async function personTookOver(sessionId: string, tag: string): Promise<boolean> {
    if (isProcessing(sessionId)) return true;
    return hasHumanMessageAfterRequest(await fetchMessages(sessionId), tag);
  }

  function standDown(sessionId: string): void {
    clearCollectingTimer(sessionId);
    sessionAutoRelayDb.transition(sessionId, ['collecting', 'creating'], { state: null, nonce: null, manual: 0 }, stamp());
    emit(sessionId);
  }

  /**
   * Sends the handoff request into the idle chat (state `collecting`, from one
   * of `from`) and arms its timeout. False when the row moved meanwhile or the
   * chat got busy — then nothing was sent.
   */
  function beginCollecting(input: {
    sessionId: string;
    projectPath: string;
    userId: number;
    options: Record<string, unknown>;
    from: Array<AutoRelayState | null>;
    manual: boolean;
  }): boolean {
    const { sessionId, userId } = input;
    const control = runControl;
    if (!control) return false;
    const tag = nonce();
    const patch = { state: 'collecting' as const, nonce: tag, user_id: userId, error: null, child_session_id: null, manual: input.manual ? 1 : 0 };
    if (!sessionAutoRelayDb.transition(sessionId, input.from, patch, stamp())) {
      return false;
    }
    prepareNoteFolder(input.projectPath);
    const started = control.start({ sessionId, userId, parentSessionId: sessionId, content: buildRelayRequest(tag, input.projectPath), options: input.options });
    if (!started) {
      // Someone wrote to the chat meanwhile: back to idle, the next turn end decides again.
      sessionAutoRelayDb.transition(sessionId, ['collecting'], { state: null, nonce: null, manual: 0 }, stamp());
      return false;
    }
    const minutes = Math.round(collectingTimeoutMs / 60_000);
    collectingTimers.set(sessionId, setTimer(() => {
      collectingTimers.delete(sessionId);
      const current = sessionAutoRelayDb.get(sessionId);
      if (current?.state === 'collecting' && current.nonce === tag) {
        fail(sessionId, current, `Записка не появилась за ${minutes} минут — новый чат не создан.`);
      }
    }, collectingTimeoutMs));
    emit(sessionId);
    return true;
  }

  /** Turn ended in an idle chat with the switch on: start the move when everything allows it. */
  async function maybeStart(sessionId: string, change: AutoRelayChange): Promise<void> {
    const control = runControl;
    if (!control) return;
    if (isProcessing(sessionId) || attentionOf(sessionId)?.state !== 'done') return;
    const session = sessionsDb.getSessionById(sessionId);
    if (!session?.project_path) return;
    if (hasRelayChild(sessionId) || hasOpenThreads(sessionId)) return;
    if (control.backgroundTaskCount(sessionId) > 0) return;

    const row = sessionAutoRelayDb.get(sessionId);
    const userId = change.userId ?? row?.user_id ?? null;
    if (userId === null || !canAccessSession({ id: userId }, sessionId)) return;

    const options = runOptionsFor(sessionId);
    const usage = usageOf(sessionId);
    const model = typeof options.model === 'string' ? options.model : usage.model;
    const input = {
      usedTokens: usage.usedTokens,
      contextWindow: await contextWindowOf(session.provider, model),
      createdAt: session.created_at ?? null,
      now: now().getTime(),
    };
    // A continuation starts with the note already read: its first measures are
    // its floor, like «Не сейчас» — it moves only after growing past them
    // (+10 points / +100K tokens), never straight from a heavy start.
    let floor: RelayDismissal | null = null;
    if (sessionLinksDb.getRow(sessionId)?.relation === 'relay') {
      floor = readBaseline(row);
      if (!floor) {
        const measures = relayMeasures(input);
        // Unknown spend: no floor yet and no move — the first known one becomes the floor.
        if (measures.usedTokens !== null) {
          sessionAutoRelayDb.upsert(sessionId, { baseline_json: JSON.stringify(measures) }, stamp());
        }
        return;
      }
    }
    const verdict = relaySuggestion({ ...input, dismissed: floor }, thresholds);
    if (!verdict.show) return;

    // A relay request already in the chat (an older tab's band) is not sent twice.
    const messages = await fetchMessages(sessionId);
    if (isRelayRequestText(lastReplyTurn(messages)?.user)) return;

    if (session.provider === 'claude' && !isLocalModel(model)) {
      const guard = await checkClaudeLimit();
      if (guard.blocked) return; // next turn end tries again
    }

    beginCollecting({ sessionId, projectPath: session.project_path, userId, options, from: [null], manual: false });
  }

  /**
   * «Перенести»: the same move as the switch's, started now by the person —
   * no threshold, the switch stays as it is. The server finishes it even if
   * the tab is closed or reloaded meanwhile; the tab follows by the frames.
   */
  async function startNow(sessionId: string, userId: number | null): Promise<AutoRelayStatus> {
    const refuse = (message: string, code: string, statusCode = 409): never => {
      throw new AppError(message, { code, statusCode });
    };
    if (!runControl) refuse('Перенос сейчас недоступен — сервер ещё запускается', 'RELAY_UNAVAILABLE', 503);
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) refuse('Чат не найден', 'SESSION_NOT_FOUND', 404);
    if (userId === null || !canAccessSession({ id: userId }, sessionId)) refuse('Нет доступа к чату', 'SESSION_ACCESS_DENIED', 403);
    if (!session!.project_path) refuse('У чата нет папки проекта', 'RELAY_NO_PROJECT', 400);
    const row = sessionAutoRelayDb.get(sessionId);
    if (row?.state === 'collecting' || row?.state === 'creating') return getStatus(sessionId);
    await ensureRegistry();
    if (isProcessing(sessionId)) refuse('Агент ещё работает — перенеси, когда он закончит ход', 'RELAY_CHAT_BUSY');
    if (hasRelayChild(sessionId)) refuse('Этот чат уже перенесён', 'RELAY_ALREADY_CONTINUED');

    const options = runOptionsFor(sessionId);
    const model = typeof options.model === 'string' ? options.model : usageOf(sessionId).model;
    if (session!.provider === 'claude' && !isLocalModel(model)) {
      const guard = await checkClaudeLimit();
      if (guard.blocked) refuse(guard.notice || 'Лимит Claude почти исчерпан — перенос подождёт', 'RELAY_LIMIT');
    }
    if (!row) sessionAutoRelayDb.upsert(sessionId, {}, stamp());
    const started = beginCollecting({
      sessionId,
      projectPath: session!.project_path!,
      userId: userId!,
      options,
      from: [null, 'failed', 'done'],
      manual: true,
    });
    if (!started) refuse('Чат занят — попробуй ещё раз через минуту', 'RELAY_CHAT_BUSY');
    return getStatus(sessionId);
  }

  /** The handoff turn ended (or paused): find the note, open the continuation. */
  async function finishCollecting(sessionId: string, row: SessionAutoRelayRow, change: AutoRelayChange): Promise<void> {
    if (change.state === 'working' || isProcessing(sessionId) || !row.nonce) return;
    const tag = relayRequestTag(row.nonce);
    const messages = await readMessages(sessionId, tag);
    // Dima wrote after the request: the chat is his again, the move stands down quietly.
    if (hasHumanMessageAfterRequest(messages, tag)) {
      standDown(sessionId);
      return;
    }
    const handoffPath = findHandoffAfterRequest(messages, tag);
    if (!handoffPath) {
      // Paused on a question or an approval: the person answers, the turn goes on.
      if (change.state === 'waiting' && MID_RUN_REASONS.has(String(change.reason ?? ''))) return;
      fail(sessionId, row, 'Агент не вывел строку HANDOFF_FILE — записку не нашёл. Новый чат не создан.');
      return;
    }
    const current = sessionAutoRelayDb.get(sessionId);
    if (!current?.enabled && !current?.manual) {
      // Switched off while the note was being written: nothing more happens.
      standDown(sessionId);
      return;
    }
    if (!sessionAutoRelayDb.transition(sessionId, ['collecting'], { state: 'creating' }, stamp())) return;
    clearCollectingTimer(sessionId);
    emit(sessionId);

    const userId = row.user_id;
    const session = sessionsDb.getSessionById(sessionId);
    const control = runControl;
    if (userId === null || !session?.project_path || !control) {
      fail(sessionId, row, 'Чат или его проект пропал — новый чат не создан');
      return;
    }
    const user = { id: userId };

    let absPath: string;
    try {
      absPath = (await resolveRelayFile({ sessionId, requestedPath: handoffPath, user })).absPath;
    } catch (error) {
      fail(sessionId, row, `${error instanceof Error ? error.message : 'Записку не проверить'}. Новый чат не создан.`);
      return;
    }

    // Once more right before anything is created: Dima may have written meanwhile.
    if (await personTookOver(sessionId, tag)) {
      standDown(sessionId);
      return;
    }

    let childId: string;
    try {
      assertCanLinkNewChild({ parentSessionId: sessionId, relation: 'relay', projectPath: session.project_path, user });
      const { sessionsService } = await import('@/modules/providers/services/sessions.service.js');
      childId = sessionsService.createAppSession(session.provider as LLMProvider, session.project_path).sessionId;
    } catch (error) {
      fail(sessionId, row, `Новый чат не создать: ${error instanceof Error ? error.message : 'ошибка'}`);
      return;
    }

    const options = runOptionsFor(sessionId);
    const parentTitle = sessionTitle(sessionId);
    const childTitle = clip(parentTitle ? `Продолжение: ${parentTitle}` : 'Продолжение чата', TITLE_MAX);
    try {
      linkSession({ childSessionId: childId, parentSessionId: sessionId, relation: 'relay', user });
      sessionsDb.updateSessionCustomName(childId, childTitle);
      if (typeof options.model === 'string') sessionsDb.updateSessionModel(childId, options.model);
      if (typeof options.effort === 'string') sessionsDb.updateSessionEffort(childId, options.effort);
      // The continuation inherits the switch, idle: it moves only past its own threshold.
      sessionAutoRelayDb.upsert(childId, { enabled: current.enabled ? 1 : 0, state: null, user_id: userId }, stamp());
    } catch (error) {
      sessionAutoRelayDb.delete(childId);
      sessionsDb.deleteSessionById(childId);
      fail(sessionId, row, `Новый чат не связать: ${error instanceof Error ? error.message : 'ошибка'}`);
      return;
    }

    // …and right before the continuation starts.
    if (await personTookOver(sessionId, tag)) {
      sessionAutoRelayDb.delete(childId);
      sessionsDb.deleteSessionById(childId);
      standDown(sessionId);
      return;
    }
    const started = control.start({
      sessionId: childId,
      userId,
      parentSessionId: sessionId,
      content: buildRelayFirstMessage(absPath),
      options,
    });
    if (!started) {
      sessionAutoRelayDb.delete(childId);
      sessionsDb.deleteSessionById(childId);
      fail(sessionId, row, 'Новый чат не запустился.');
      return;
    }

    sessionAutoRelayDb.transition(sessionId, ['creating'], { state: 'done', child_session_id: childId, error: null }, stamp());
    broadcastUpsert(childId);
    broadcastUpsert(sessionId);
    markSeen(userId, sessionId);
    emit(sessionId);
    // «Перенести» was pressed in the open tab, which follows by itself: no push for it.
    if (!current.manual) {
      notify({ kind: 'done', userId, provider: session.provider, sessionId, childSessionId: childId, childTitle });
    }
  }

  /** Every status change of any chat (session-attention onChange). */
  async function handleAttentionChange(change: AutoRelayChange): Promise<void> {
    const sessionId = change.sessionId;
    if (busy.has(sessionId)) {
      again.set(sessionId, change);
      return;
    }
    busy.add(sessionId);
    try {
      let next: AutoRelayChange | undefined = change;
      while (next) {
        again.delete(sessionId);
        await step(next);
        next = again.get(sessionId);
      }
    } finally {
      busy.delete(sessionId);
      again.delete(sessionId);
    }
  }

  async function step(change: AutoRelayChange): Promise<void> {
    const sessionId = change.sessionId;
    try {
      const row = sessionAutoRelayDb.get(sessionId);
      if (!row) return;
      if (row.state === 'collecting') {
        await ensureRegistry();
        await finishCollecting(sessionId, row, change);
        return;
      }
      if (!row.enabled || row.state !== null || change.state !== 'done') return;
      await ensureRegistry();
      await maybeStart(sessionId, change);
    } catch (error) {
      console.error('[AutoRelay] step failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function getStatus(sessionId: string): AutoRelayStatus {
    return toStatus(sessionId, sessionAutoRelayDb.get(sessionId));
  }

  /**
   * The switch. Turning it on after a failure starts over (idle); a finished
   * move stays finished. Turning it off mid-move lets the running turn end,
   * then nothing more happens.
   */
  function setEnabled(sessionId: string, enabled: boolean, userId: number | null): AutoRelayStatus {
    const row = sessionAutoRelayDb.get(sessionId);
    const patch: Parameters<typeof sessionAutoRelayDb.upsert>[1] = { enabled: enabled ? 1 : 0 };
    if (row?.state === 'failed') {
      patch.state = null;
      patch.error = null;
      patch.nonce = null;
      patch.manual = 0;
    }
    if (userId !== null) patch.user_id = userId;
    sessionAutoRelayDb.upsert(sessionId, patch, stamp());
    emit(sessionId);
    return getStatus(sessionId);
  }

  /** A chat was just created: a relay continuation inherits the switch, any other follows the user's default. */
  function applyNewChatDefaults(input: { sessionId: string; userId: number | null; parentSessionId?: string | null; relation?: string | null }): void {
    try {
      const inherited = input.relation === 'relay' && input.parentSessionId
        ? Boolean(sessionAutoRelayDb.get(input.parentSessionId)?.enabled)
        : false;
      const byDefault = input.userId !== null && newChatsDefault(input.userId);
      if (inherited || byDefault) {
        sessionAutoRelayDb.upsert(input.sessionId, { enabled: 1, user_id: input.userId }, stamp());
      }
    } catch (error) {
      console.error('[AutoRelay] could not apply the new-chat default', {
        sessionId: input.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Server start: a move cut short by the restart cannot be finished (the
   * handoff turn died with the process) — told once, the switch goes off.
   */
  function reconcileOnBoot(): number {
    const rows = sessionAutoRelayDb.listInProgress();
    for (const row of rows) {
      fail(row.session_id, row, 'Сервер перезапустился во время переноса — новый чат не создан.');
    }
    return rows.length;
  }

  return {
    getStatus,
    setEnabled,
    startNow,
    applyNewChatDefaults,
    handleAttentionChange,
    reconcileOnBoot,
    setRunControl(control: AutoRelayRunControl): void {
      runControl = control;
    },
  };
}

export type AutoRelayService = ReturnType<typeof createAutoRelayService>;

export const autoRelayService: AutoRelayService = createAutoRelayService();

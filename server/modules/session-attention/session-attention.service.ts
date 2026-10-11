/**
 * Session attention ("Ждут тебя"): the server-side status of every app session.
 *
 * Fed from exactly two places — the run start and the run registry's event
 * hook, which every engine (Claude, Codex, Grok, …) flows through — and
 * persisted in SQLite so the status survives a page reload and a server
 * restart.
 *
 *   start                              → working
 *   permission_request                 → waiting / ask | plan | permission
 *   permission_cancelled, answer       → working (or the next pending request)
 *   complete aborted                   → done, already seen by the actor
 *   complete exitCode ≠ 0              → failed / error
 *   complete ok, request still pending → stays waiting (Grok: question asked, CLI exited)
 *   complete ok                        → classifier on the last assistant text:
 *                                        waiting / manual_ask | text_question, or done
 *   server boot, working left over     → failed / interrupted
 *
 * Every transition calls the `onChange` listeners (push, Telegram) and
 * broadcasts a content-free `attention_changed` frame to all websockets; the
 * content itself is only served by `GET /api/attention`, which filters by
 * project access.
 */

import path from 'node:path';

import {
  sessionAttentionDb,
  userProjectAccessDb,
  type SessionAttentionListRow,
  type SessionAttentionRow,
} from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import { listGrokQuestionsForAppSession } from '@/shared/grok-question.js';
import { classifyTurnEnding, clipText } from '@/shared/turn-ending.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AttentionState = 'working' | 'waiting' | 'done' | 'failed';

export type AttentionReason =
  | 'ask'
  | 'plan'
  | 'permission'
  | 'manual_ask'
  | 'text_question'
  | 'error'
  | 'interrupted'
  | null;

/** One AskUserQuestion question, kept whole so push/Telegram can build buttons. */
export type AttentionQuestion = {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect: boolean;
};

export type AttentionDetail = {
  /** First question text (ask), plan headline (plan), tool summary (permission), or the text question. */
  question?: string;
  /** Option labels of the first question (ask). */
  options?: string[];
  /** Every question with its options and multiSelect flag (ask). */
  questions?: AttentionQuestion[];
  /** Pending request id — the handle answers are given with (ask / plan / permission). */
  requestId?: string;
  /** Tool that asked: AskUserQuestion, ExitPlanMode, Bash, … */
  toolName?: string;
  /** Short error text, ≤200 chars (failed). */
  error?: string;
  /** Last paragraph of the reply (manual_ask / text_question) or the plan text (plan). */
  excerpt?: string;
};

export interface AttentionItem {
  sessionId: string;
  projectId: string;
  projectName: string;
  provider: string;
  title: string | null;
  state: AttentionState;
  reason: AttentionReason;
  detail: AttentionDetail | null;
  updatedAt: string;
  /** done/failed only: updated after this user last looked at the session. */
  unread: boolean;
}

export type AttentionCounts = {
  waiting: number;
  /** Unread failed sessions (seen failures stop counting). */
  failed: number;
  unreadDone: number;
  working: number;
};

/** The authenticated user as `req.user` carries it. */
export type AttentionUser = {
  id: number | string;
  role?: string | null;
};

/** Payload of every `onChange` call — one per state transition. */
export type AttentionChange = {
  sessionId: string;
  /** Who started the session's last run (row owner), null when unknown. */
  userId: number | null;
  projectId: string | null;
  provider: string;
  state: AttentionState;
  reason: AttentionReason;
  detail: AttentionDetail | null;
  updatedAt: string;
  previous: { state: AttentionState; reason: AttentionReason; requestId: string | null } | null;
};

/** The slice of a registry run this module needs. */
export type AttentionRunRef = {
  appSessionId: string;
  provider: string;
  userId?: string | number | null;
  projectId?: string | null;
};

/** The slice of a NormalizedMessage this module reads. */
export type AttentionRunEvent = {
  kind: string;
  role?: string;
  content?: unknown;
  requestId?: unknown;
  toolName?: unknown;
  input?: unknown;
  exitCode?: unknown;
  aborted?: unknown;
  [key: string]: unknown;
};

export type SessionAttentionDependencies = {
  /** Last assistant text from the persisted transcript; fallback when the run streamed none. */
  fetchLastAssistantText?: (appSessionId: string) => Promise<string | null>;
  /**
   * Whether a request is still answerable after the run completed. Default:
   * Grok questions are looked up in the Grok pending store, Grok plan exits
   * are trusted (answering one starts a new run), other engines' requests die
   * with their process.
   */
  isRequestPending?: (input: {
    provider: string;
    appSessionId: string;
    requestId: string;
    reason: AttentionReason;
  }) => boolean;
  /** Sends one frame to every connected websocket. */
  broadcast?: (payload: Record<string, unknown>) => void;
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const ERROR_MAX = 200;
const QUESTION_MAX = 200;
const PLAN_EXCERPT_MAX = 1000;

type PendingRequest = {
  requestId: string;
  reason: Exclude<AttentionReason, null>;
  detail: AttentionDetail;
};

/**
 * Per-session memory of the current run: its text stream, last error, open
 * requests and who pressed Stop. Released on the terminal `complete`; only
 * still-open requests outlive it.
 */
type RunMemory = {
  lastText: string;
  deltaBuffer: string;
  deltaOpen: boolean;
  lastError: string | null;
  pending: PendingRequest[];
  stopActorId: number | null;
};

function emptyMemory(): RunMemory {
  return { lastText: '', deltaBuffer: '', deltaOpen: false, lastError: null, pending: [], stopActorId: null };
}

function toUserId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeQuestions(input: unknown): AttentionQuestion[] {
  const raw = asRecord(input)?.questions;
  if (!Array.isArray(raw)) {
    return [];
  }
  const questions: AttentionQuestion[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record || typeof record.question !== 'string') {
      continue;
    }
    const options = (Array.isArray(record.options) ? record.options : [])
      .map((option) => {
        if (typeof option === 'string') {
          return { label: option };
        }
        const optionRecord = asRecord(option);
        if (!optionRecord || typeof optionRecord.label !== 'string') {
          return null;
        }
        return typeof optionRecord.description === 'string' && optionRecord.description
          ? { label: optionRecord.label, description: optionRecord.description }
          : { label: optionRecord.label };
      })
      .filter((option): option is { label: string; description?: string } => option !== null);
    questions.push({
      question: record.question,
      ...(typeof record.header === 'string' && record.header ? { header: record.header } : {}),
      options,
      multiSelect: Boolean(record.multiSelect),
    });
  }
  return questions;
}

function reasonForTool(toolName: string): 'ask' | 'plan' | 'permission' {
  if (toolName === 'AskUserQuestion') {
    return 'ask';
  }
  if (/^(?:ExitPlanMode|exit_plan_mode)$/i.test(toolName)) {
    return 'plan';
  }
  return 'permission';
}

function summarizeToolRequest(toolName: string, input: unknown): string {
  const record = asRecord(input);
  const target = record
    ? [record.command, record.file_path, record.path, record.url, record.pattern, record.description]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : undefined;
  return clipText(target ? `${toolName}: ${target}` : toolName, QUESTION_MAX);
}

function buildPendingRequest(event: AttentionRunEvent): PendingRequest | null {
  if (typeof event.requestId !== 'string' || !event.requestId) {
    return null;
  }
  const toolName = typeof event.toolName === 'string' && event.toolName ? event.toolName : 'unknown';
  const reason = reasonForTool(toolName);
  const base: AttentionDetail = { requestId: event.requestId, toolName };

  if (reason === 'ask') {
    const questions = normalizeQuestions(event.input);
    const first = questions[0];
    return {
      requestId: event.requestId,
      reason,
      detail: {
        ...base,
        ...(first ? { question: first.question, options: first.options.map((option) => option.label) } : {}),
        questions,
      },
    };
  }

  if (reason === 'plan') {
    const plan = typeof asRecord(event.input)?.plan === 'string' ? (asRecord(event.input)?.plan as string) : '';
    const headline = plan
      .split('\n')
      .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
      .find((line) => line.length > 0);
    return {
      requestId: event.requestId,
      reason,
      detail: {
        ...base,
        ...(headline ? { question: clipText(headline, QUESTION_MAX) } : {}),
        ...(plan.trim() ? { excerpt: clipText(plan, PLAN_EXCERPT_MAX) } : {}),
      },
    };
  }

  return {
    requestId: event.requestId,
    reason,
    detail: { ...base, question: summarizeToolRequest(toolName, event.input) },
  };
}

function parseDetail(json: string | null): AttentionDetail | null {
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json);
    return asRecord(parsed) ? (parsed as AttentionDetail) : null;
  } catch {
    return null;
  }
}

function isAdmin(user: AttentionUser): boolean {
  return user.role === 'admin';
}

function defaultIsRequestPending(input: {
  provider: string;
  appSessionId: string;
  requestId: string;
  reason: AttentionReason;
}): boolean {
  if (input.provider !== 'grok') {
    return false;
  }
  if (input.reason === 'ask') {
    return listGrokQuestionsForAppSession(input.appSessionId).some((pending) => pending.requestId === input.requestId);
  }
  return input.reason === 'plan';
}

async function defaultFetchLastAssistantText(appSessionId: string): Promise<string | null> {
  const { sessionsService } = await import('@/modules/providers/services/sessions.service.js');
  const history = await sessionsService.fetchHistory(appSessionId, { limit: 40, offset: 0 });
  for (let index = history.messages.length - 1; index >= 0; index -= 1) {
    const message = history.messages[index];
    if (message.kind === 'text' && message.role === 'assistant' && typeof message.content === 'string' && message.content.trim()) {
      return message.content;
    }
  }
  return null;
}

function defaultBroadcast(payload: Record<string, unknown>): void {
  const frame = JSON.stringify(payload);
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(frame);
    }
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createSessionAttentionService(dependencies: SessionAttentionDependencies = {}) {
  const fetchLastAssistantText = dependencies.fetchLastAssistantText ?? defaultFetchLastAssistantText;
  const isRequestPending = dependencies.isRequestPending ?? defaultIsRequestPending;
  const broadcast = dependencies.broadcast ?? defaultBroadcast;
  const now = dependencies.now ?? (() => new Date());

  const listeners = new Set<(change: AttentionChange) => void>();
  const memory = new Map<string, RunMemory>();
  /** History lookups in flight, by session; a new run start invalidates its token. */
  const fallbackTokens = new Map<string, number>();
  let fallbackCounter = 0;

  function memoryFor(sessionId: string): RunMemory {
    let entry = memory.get(sessionId);
    if (!entry) {
      entry = emptyMemory();
      memory.set(sessionId, entry);
    }
    return entry;
  }

  /** Drops the finished run's buffers; keeps the entry only for still-open requests. */
  function releaseMemory(sessionId: string, mem: RunMemory): void {
    if (mem.pending.length === 0) {
      memory.delete(sessionId);
      return;
    }
    mem.lastText = '';
    mem.deltaBuffer = '';
    mem.deltaOpen = false;
    mem.lastError = null;
    mem.stopActorId = null;
  }

  function broadcastChanged(sessionId: string): void {
    try {
      broadcast({ kind: 'attention_changed', sessionId, timestamp: now().toISOString() });
    } catch (error) {
      console.error('[SessionAttention] broadcast failed', { sessionId, error: (error as Error)?.message });
    }
  }

  /**
   * Writes the next status of a session and notifies listeners. No-op (no
   * write, no event) when state, reason and detail are all unchanged.
   */
  function transition(
    run: { sessionId: string; provider: string; userId: number | null; projectId: string | null },
    next: { state: AttentionState; reason: AttentionReason; detail: AttentionDetail | null },
  ): SessionAttentionRow | null {
    const previous = sessionAttentionDb.get(run.sessionId);
    const detailJson = next.detail ? JSON.stringify(next.detail) : null;
    if (
      previous
      && previous.state === next.state
      && (previous.reason ?? null) === next.reason
      && (previous.detail_json ?? null) === detailJson
    ) {
      return null;
    }

    const row: SessionAttentionRow = {
      session_id: run.sessionId,
      user_id: run.userId ?? previous?.user_id ?? null,
      project_id: run.projectId ?? previous?.project_id ?? null,
      provider: run.provider || previous?.provider || 'unknown',
      state: next.state,
      reason: next.reason,
      detail_json: detailJson,
      updated_at: now().toISOString(),
    };
    sessionAttentionDb.upsert(row);

    const previousDetail = previous ? parseDetail(previous.detail_json) : null;
    const change: AttentionChange = {
      sessionId: row.session_id,
      userId: row.user_id,
      projectId: row.project_id,
      provider: row.provider,
      state: next.state,
      reason: next.reason,
      detail: next.detail,
      updatedAt: row.updated_at,
      previous: previous
        ? {
          state: previous.state as AttentionState,
          reason: (previous.reason ?? null) as AttentionReason,
          requestId: previousDetail?.requestId ?? null,
        }
        : null,
    };

    for (const listener of listeners) {
      try {
        listener(change);
      } catch (error) {
        console.error('[SessionAttention] onChange listener failed', { sessionId: row.session_id, error: (error as Error)?.message });
      }
    }
    broadcastChanged(row.session_id);
    return row;
  }

  function runContext(run: AttentionRunRef) {
    return {
      sessionId: run.appSessionId,
      provider: run.provider,
      userId: toUserId(run.userId),
      projectId: run.projectId ?? null,
    };
  }

  /** After a request was answered or withdrawn: show the next open one, else back to working. */
  function settleAfterRequest(run: AttentionRunRef, mem: RunMemory): void {
    const nextPending = mem.pending[mem.pending.length - 1];
    if (nextPending) {
      transition(runContext(run), { state: 'waiting', reason: nextPending.reason, detail: nextPending.detail });
      return;
    }
    transition(runContext(run), { state: 'working', reason: null, detail: null });
  }

  function applyTurnEnding(run: AttentionRunRef, text: string | null): void {
    const ending = classifyTurnEnding(text ?? '');
    if (ending.kind === 'manual_ask') {
      transition(runContext(run), { state: 'waiting', reason: 'manual_ask', detail: { excerpt: ending.excerpt } });
      return;
    }
    if (ending.kind === 'question') {
      transition(runContext(run), {
        state: 'waiting',
        reason: 'text_question',
        detail: { question: ending.excerpt, excerpt: ending.excerpt },
      });
      return;
    }
    transition(runContext(run), { state: 'done', reason: null, detail: null });
  }

  function handleComplete(run: AttentionRunRef, event: AttentionRunEvent, mem: RunMemory): void {
    const context = runContext(run);
    const lastText = mem.lastText;
    const lastError = mem.lastError;
    const stopActorId = mem.stopActorId;

    if (event.aborted === true) {
      mem.pending = [];
      releaseMemory(context.sessionId, mem);
      const row = transition(context, { state: 'done', reason: null, detail: null })
        ?? sessionAttentionDb.get(context.sessionId);
      // Stop is not news to whoever pressed it: mark it seen for them at once.
      if (row && stopActorId !== null) {
        sessionAttentionDb.markSeen(stopActorId, [context.sessionId], row.updated_at);
      }
      return;
    }

    // Codex emits a bare `complete` (no exitCode) on every turn.completed —
    // that is a successful turn end, not a failure.
    const exitCode = typeof event.exitCode === 'number' ? event.exitCode : 0;
    if (exitCode !== 0) {
      mem.pending = [];
      releaseMemory(context.sessionId, mem);
      const error = clipText(lastError || `Движок завершился с кодом ${exitCode}`, ERROR_MAX);
      transition(context, { state: 'failed', reason: 'error', detail: { error } });
      return;
    }

    mem.pending = mem.pending.filter((pending) =>
      isRequestPending({
        provider: run.provider,
        appSessionId: context.sessionId,
        requestId: pending.requestId,
        reason: pending.reason,
      }),
    );
    const lastPending = mem.pending[mem.pending.length - 1];
    releaseMemory(context.sessionId, mem);
    if (lastPending) {
      transition(context, { state: 'waiting', reason: lastPending.reason, detail: lastPending.detail });
      return;
    }

    if (lastText.trim()) {
      applyTurnEnding(run, lastText);
      return;
    }

    // Nothing streamed (or only tool output): read the transcript instead.
    // A newer run that started meanwhile owns the status — drop the result.
    fallbackCounter += 1;
    const token = fallbackCounter;
    fallbackTokens.set(context.sessionId, token);
    void fetchLastAssistantText(context.sessionId)
      .catch((error) => {
        console.warn('[SessionAttention] history fallback failed', { sessionId: context.sessionId, error: (error as Error)?.message });
        return null;
      })
      .then((text) => {
        if (fallbackTokens.get(context.sessionId) !== token) {
          return;
        }
        fallbackTokens.delete(context.sessionId);
        try {
          applyTurnEnding(run, text);
        } catch (error) {
          console.error('[SessionAttention] could not record turn ending', { sessionId: context.sessionId, error: (error as Error)?.message });
        }
      });
  }

  function visibleRows(user: AttentionUser): SessionAttentionListRow[] {
    const userId = toUserId(user.id);
    const rows = sessionAttentionDb.listWithSeen(userId);
    if (isAdmin(user)) {
      return rows;
    }
    if (userId === null) {
      return [];
    }
    const accessible = new Set(userProjectAccessDb.getAccessibleProjectIds(userId));
    return rows.filter((row) => row.resolved_project_id !== null && accessible.has(row.resolved_project_id));
  }

  function toItem(row: SessionAttentionListRow): AttentionItem {
    const state = row.state as AttentionState;
    const isFinal = state === 'done' || state === 'failed';
    const unread = isFinal && (!row.seen_at || Date.parse(row.updated_at) > Date.parse(row.seen_at));
    const projectPath = row.project_path ?? '';
    const projectName = row.custom_project_name?.trim() || path.basename(projectPath) || projectPath;
    return {
      sessionId: row.session_id,
      projectId: row.resolved_project_id ?? '',
      projectName,
      provider: row.provider,
      title: row.session_name?.trim() ? row.session_name : null,
      state,
      reason: (row.reason ?? null) as AttentionReason,
      detail: parseDetail(row.detail_json),
      updatedAt: row.updated_at,
      unread,
    };
  }

  return {
    /** A run started for the session: status becomes `working`, run memory resets. */
    recordRunStart(input: {
      appSessionId: string;
      userId: string | number | null;
      provider: string;
      projectId: string | null;
    }): void {
      memory.set(input.appSessionId, emptyMemory());
      fallbackTokens.delete(input.appSessionId);
      transition(
        { sessionId: input.appSessionId, provider: input.provider, userId: toUserId(input.userId), projectId: input.projectId },
        { state: 'working', reason: null, detail: null },
      );
    },

    /** One outbound event of a live run (already remapped to the app session id). */
    recordRunEvent(run: AttentionRunRef, event: AttentionRunEvent): void {
      const mem = memoryFor(run.appSessionId);

      if (event.kind === 'stream_delta') {
        if (typeof event.content === 'string') {
          if (!mem.deltaOpen) {
            mem.deltaBuffer = '';
          }
          mem.deltaBuffer += event.content;
          mem.deltaOpen = true;
          mem.lastText = mem.deltaBuffer;
        }
        return;
      }
      mem.deltaOpen = false;

      switch (event.kind) {
        case 'text':
          if (event.role === 'assistant' && typeof event.content === 'string' && event.content.trim()) {
            mem.lastText = event.content;
          }
          return;
        case 'error':
          if (typeof event.content === 'string' && event.content.trim()) {
            mem.lastError = event.content;
          }
          return;
        case 'permission_request': {
          const pending = buildPendingRequest(event);
          if (!pending) {
            return;
          }
          mem.pending = mem.pending.filter((entry) => entry.requestId !== pending.requestId);
          mem.pending.push(pending);
          transition(runContext(run), { state: 'waiting', reason: pending.reason, detail: pending.detail });
          return;
        }
        case 'permission_cancelled': {
          if (typeof event.requestId !== 'string') {
            return;
          }
          const before = mem.pending.length;
          mem.pending = mem.pending.filter((entry) => entry.requestId !== event.requestId);
          if (mem.pending.length !== before) {
            settleAfterRequest(run, mem);
          }
          return;
        }
        case 'complete':
          handleComplete(run, event, mem);
          return;
        default:
      }
    },

    /**
     * The user pressed Stop for this session. Remembered so the aborted
     * `complete` marks the session seen for that user (not the run owner).
     * Unknown actor → nothing is marked.
     */
    recordStopActor(appSessionId: string, actorUserId: string | number | null): void {
      const actor = toUserId(actorUserId);
      if (actor === null || !memory.has(appSessionId)) {
        return;
      }
      memoryFor(appSessionId).stopActorId = actor;
    },

    /**
     * A pending request was answered (UI, push, Telegram). Claude keeps running
     * after the answer, so the status goes back to `working` (or to the next
     * open request). Unknown request ids are ignored.
     */
    recordAnswer(requestId: string): void {
      for (const [sessionId, mem] of memory) {
        if (!mem.pending.some((entry) => entry.requestId === requestId)) {
          continue;
        }
        mem.pending = mem.pending.filter((entry) => entry.requestId !== requestId);
        const row = sessionAttentionDb.get(sessionId);
        settleAfterRequest({ appSessionId: sessionId, provider: row?.provider ?? 'unknown' }, mem);
        return;
      }
    },

    /** Sessions the user may see (admin: all; others: granted projects), newest first. */
    listForUser(user: AttentionUser): AttentionItem[] {
      return visibleRows(user).map(toItem);
    },

    /** Counters for the tab title / badge: N = waiting + failed + unreadDone. */
    countsFor(items: AttentionItem[]): AttentionCounts {
      const counts: AttentionCounts = { waiting: 0, failed: 0, unreadDone: 0, working: 0 };
      for (const item of items) {
        if (item.state === 'waiting') counts.waiting += 1;
        else if (item.state === 'working') counts.working += 1;
        else if (item.state === 'failed' && item.unread) counts.failed += 1;
        else if (item.state === 'done' && item.unread) counts.unreadDone += 1;
      }
      return counts;
    },

    /**
     * Marks sessions as seen by this user only. `{all:true}` clears every
     * unread done/failed session the user can see; waiting sessions are not
     * affected (only an answer closes them). Ids the user cannot see are ignored.
     */
    markSeen(user: AttentionUser, target: { sessionIds: string[] } | { all: true }): { marked: number } {
      const userId = toUserId(user.id);
      if (userId === null) {
        return { marked: 0 };
      }
      const items = visibleRows(user).map(toItem);
      let ids: string[];
      if ('all' in target && target.all === true) {
        ids = items.filter((item) => item.state === 'done' || item.state === 'failed').map((item) => item.sessionId);
      } else {
        const wanted = new Set(Array.isArray((target as { sessionIds?: unknown }).sessionIds)
          ? (target as { sessionIds: unknown[] }).sessionIds.filter((id): id is string => typeof id === 'string')
          : []);
        ids = items.filter((item) => wanted.has(item.sessionId)).map((item) => item.sessionId);
      }
      sessionAttentionDb.markSeen(userId, ids, now().toISOString());
      for (const sessionId of ids) {
        broadcastChanged(sessionId);
      }
      return { marked: ids.length };
    },

    /**
     * Run once at server start. A `working` row without a live run belonged to
     * the previous process: it becomes failed/interrupted. A Claude-style
     * request (the process was waiting inside the run) died the same way.
     * A Grok question/plan was asked after its CLI had already exited, but the
     * in-memory pending store is gone — it stays waiting as a text question
     * (answerable by typing, no buttons).
     */
    reconcileOnBoot(options: { isRunAlive?: (appSessionId: string) => boolean } = {}): number {
      const isRunAlive = options.isRunAlive ?? (() => false);
      let changed = 0;
      for (const row of sessionAttentionDb.listByStates(['working', 'waiting'])) {
        if (isRunAlive(row.session_id)) {
          continue;
        }
        const context = { sessionId: row.session_id, provider: row.provider, userId: row.user_id, projectId: row.project_id };
        const reason = (row.reason ?? null) as AttentionReason;
        if (row.state === 'working') {
          transition(context, {
            state: 'failed',
            reason: 'interrupted',
            detail: { error: 'Сервер перезапустился во время работы' },
          });
          changed += 1;
          continue;
        }
        if (reason !== 'ask' && reason !== 'plan' && reason !== 'permission') {
          continue;
        }
        const detail = parseDetail(row.detail_json);
        if (row.provider === 'grok') {
          const question = detail?.question ?? 'Агент ждёт ответа';
          transition(context, {
            state: 'waiting',
            reason: 'text_question',
            detail: { question, excerpt: question },
          });
        } else {
          transition(context, {
            state: 'failed',
            reason: 'interrupted',
            detail: { error: 'Сервер перезапустился, пока агент ждал ответа' },
          });
        }
        changed += 1;
      }
      memory.clear();
      fallbackTokens.clear();
      return changed;
    },

    /** Subscribes to every transition; returns the unsubscribe function. */
    onChange(listener: (change: AttentionChange) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SessionAttentionService = ReturnType<typeof createSessionAttentionService>;

/** Process-wide instance used by the run registry, routes and boot. */
export const sessionAttention: SessionAttentionService = createSessionAttentionService();

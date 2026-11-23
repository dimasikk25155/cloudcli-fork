/**
 * «Очередь сообщений»: a message typed while the agent is busy is kept on the
 * server — one cell per chat — and sent by the server when the turn ends. No
 * tab has to be open for that (23.11.2026: a message queued in the browser
 * left only when the chat was opened again).
 *
 * The one decision of this module, taken from the chat status
 * (`session-attention`) after every change of it:
 *
 *   done                → send (through the chat gateway, as the user who queued)
 *   waiting             → hold «question» (lifted when the agent works on)
 *   failed              → hold «failed»
 *   done after «Стоп»   → hold «stopped» (unless the user asked «send now»)
 *   the send failed     → hold «error» + a reason for a person
 *   server restart      → hold «restart»
 *
 * «Фон доживает до конца»: a Claude process kept for its background is
 * between turns, not busy — `isRunLive` is false there, so a put and «send
 * now» go straight into it (no «Стоп», which would kill the background).
 * «Ждёт помощников» changes no status, so the gateway also calls
 * `handleAttentionChange` on such a turn boundary and on the end of a held run.
 *
 * «failed», «stopped», «error» and «restart» stay until the user acts: edits
 * the message (a fresh put), presses «send now», or removes it. The queue
 * never retries by itself.
 *
 * Two more ways into the cell and out of it:
 * - a message that was SENT (`chat.send`) but that the chat's live process
 *   could not take is kept here by the gateway (`deferSent`) and leaves when
 *   that turn or run ends — it is never held as «question»: it is the answer;
 * - the engine's limit on new runs (Claude's 5-hour guard) is asked BEFORE the
 *   run (`checkSendLimit`): a run refused inside the runtime would already
 *   have taken the message out of the cell. Refused → «error» with the reason;
 *   «send now» on that card is the user's «run anyway».
 *
 * Everything outside the cell is injected: the gateway (`sendAsUser`,
 * `isRunLive`, `abortRun`), the chat status (`getAttention`) and the
 * content-free frame (`notifyChanged`).
 */

import { queuedMessagesDb, type QueuedMessageRow, type QueuedMessagesDb } from '@/modules/database/index.js';
import { logChatEvent, type ChatEventFields, type ChatEventName } from '@/shared/chat-event-log.js';
import { AppError } from '@/shared/utils.js';

import { QUEUED_HOLD_REASONS, type QueuedHoldReason, type QueuedMessage } from '../../../shared/queued-message.js';
import type { RunPhase } from '../../../shared/run-phase.js';

/** The slice of the chat status the queue decides by. `stopped` = the last turn ended with «Стоп». */
export type QueueAttention = {
  state: 'working' | 'waiting' | 'done' | 'failed';
  stopped?: boolean;
};

export type QueuedSendInput = {
  sessionId: string;
  /** Who queued the message — the run starts on their behalf. */
  userId: number | null;
  content: string;
  options: Record<string, unknown>;
  images: unknown[];
  /** The sender's tab already drew this message's bubble (a kept `chat.send`): the gateway draws no second one. */
  echoed?: boolean;
};

/**
 * `busy` = the chat already has a run (someone was faster): not an error, the
 * message waits for that run. Otherwise `error` is a reason for a person.
 */
export type QueuedSendOutcome =
  | { started: true }
  | { started: false; busy: boolean; error: string };

/**
 * The chat gateway's side of the queue (`createQueuedSendControl` in the
 * websocket module): everything the queue needs from live runs.
 */
export type QueuedSendControl = {
  /** Starts an ordinary run with the message, as its user. Synchronous, like `chat.send`. */
  send(input: QueuedSendInput): QueuedSendOutcome;
  /** A turn is going right now (a held run between turns is not one). */
  isRunLive(sessionId: string): boolean;
  /** Phase of the chat's live run; null = no live run. */
  runPhase(sessionId: string): RunPhase | null;
  /** «Стоп» for a user; settles when the engine was told. False = nothing was running. */
  abortRun(sessionId: string, userId: number | null): Promise<boolean>;
  /** The chat's last run ended with «Стоп». */
  lastRunStopped(sessionId: string): boolean;
  /** The engine would refuse a new run with this message now: the reason for a person; null = go. */
  sendLimit?(input: QueuedSendInput): Promise<string | null>;
};

export type QueuedPutInput = {
  content: string;
  options?: Record<string, unknown>;
  images?: unknown[];
};

export type QueuedMessagesDependencies = {
  db?: QueuedMessagesDb;
  /** Starts an ordinary run with the message (the chat gateway's `beginChatSend`). */
  sendAsUser: (input: QueuedSendInput) => QueuedSendOutcome | Promise<QueuedSendOutcome>;
  /**
   * The engine's limit on new runs, asked before every send: a reason for a
   * person when the run would be refused now, null = go. With it the message
   * is sent with `usageGuardOverride` — the limit was asked here, the runtime
   * must not answer a second time after the message has left the cell.
   * A failure of the check never blocks. Absent = nobody is asked.
   */
  checkSendLimit?: (input: QueuedSendInput) => string | null | Promise<string | null>;
  /** Current status of the chat; null = the chat never ran. */
  getAttention: (sessionId: string) => QueueAttention | null;
  /** A turn of the chat is going right now (a held run between turns is not one). */
  isRunLive: (sessionId: string) => boolean;
  /** Phase of the chat's live run, null = none. Absent = the engine has no phases. */
  runPhase?: (sessionId: string) => RunPhase | null;
  /** «Стоп» on behalf of a user; settles when the run is stopped. False = nothing was running. */
  abortRun: (sessionId: string, userId: number | null) => boolean | Promise<boolean>;
  /** Content-free «re-read the queue of this chat». */
  notifyChanged?: (sessionId: string) => void;
  now?: () => Date;
  log?: (event: ChatEventName, fields: ChatEventFields) => void;
};

/** Longest text the queue takes (the composer's own messages are far below it). */
export const QUEUED_CONTENT_MAX = 1_000_000;
export const QUEUED_IMAGES_MAX = 50;
const OPTIONS_JSON_MAX = 256_000;
const ERROR_MAX = 300;

/** Holds only the user lifts: a status change of the chat never overrides them. */
const STICKY_HOLDS: ReadonlySet<string> = new Set<QueuedHoldReason>(['stopped', 'failed', 'restart', 'error']);

function badRequest(message: string, code = 'QUEUED_MESSAGE_INVALID'): AppError {
  return new AppError(message, { statusCode: 400, code });
}

function parseObject(json: string | null): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function parseArray(json: string | null): unknown[] | undefined {
  if (!json) return undefined;
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function toHoldReason(value: string | null): QueuedHoldReason | null {
  return (QUEUED_HOLD_REASONS as readonly string[]).includes(value ?? '') ? value as QueuedHoldReason : null;
}

function toQueued(row: QueuedMessageRow): QueuedMessage {
  const options = parseObject(row.optionsJson);
  const images = parseArray(row.imagesJson);
  const holdReason = toHoldReason(row.holdReason);
  return {
    sessionId: row.sessionId,
    content: row.content,
    ...(options ? { options } : {}),
    ...(images ? { images } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    holdReason,
    lastError: holdReason === 'error' ? row.lastError : null,
  };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A message with its size checked, ready for the cell. */
type CellContent = { content: string; optionsJson: string | null; imagesJson: string | null; images: number };

export function createQueuedMessagesService(dependencies: QueuedMessagesDependencies) {
  const db = dependencies.db ?? queuedMessagesDb;
  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? logChatEvent;
  /**
   * ISO stamps that never repeat inside this process: `updated_at` is also the
   * version of the cell (see `trySend`), so two changes in one millisecond
   * must still differ.
   */
  let lastStampMs = 0;
  const stamp = (): string => {
    lastStampMs = Math.max(now().getTime(), lastStampMs + 1);
    return new Date(lastStampMs).toISOString();
  };
  let notifications = 0;
  /** One send at a time per chat: a second trigger while the gateway is starting the run is dropped. */
  const sending = new Set<string>();
  /**
   * Cells that hold a kept `chat.send` (see `deferSent`), by their version:
   * an edit or a hold makes the cell an ordinary queued message again. In
   * memory only — after a restart everything queued waits for the user anyway.
   */
  const sentCells = new Map<string, { version: string; echoed: boolean }>();
  /** Cells the engine's limit refused, by their version: «send now» on exactly that card runs it anyway. */
  const limitRefused = new Map<string, string>();

  function forget(sessionId: string): void {
    sentCells.delete(sessionId);
    limitRefused.delete(sessionId);
  }

  function notify(sessionId: string): void {
    notifications += 1;
    try {
      dependencies.notifyChanged?.(sessionId);
    } catch (error) {
      console.error('[QueuedMessages] notify failed', { sessionId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function hold(row: QueuedMessageRow, holdReason: QueuedHoldReason, lastError: string | null = null): void {
    if (!db.setHold(row.sessionId, { holdReason, lastError, at: stamp() })) return;
    log('queue_hold', { sessionId: row.sessionId, userId: row.userId, reason: holdReason });
    notify(row.sessionId);
  }

  function liftHold(row: QueuedMessageRow): void {
    if (row.holdReason === null) return;
    if (db.setHold(row.sessionId, { holdReason: null, lastError: null, at: stamp() })) {
      notify(row.sessionId);
    }
  }

  /**
   * Hands the message to the gateway. True = a run started with it and the
   * cell is empty (or holds a newer edit). The message is removed only after
   * the run started — a failure never loses it.
   */
  async function trySend(row: QueuedMessageRow, manual: boolean): Promise<boolean> {
    const sessionId = row.sessionId;
    if (sending.has(sessionId)) return false;
    const input: QueuedSendInput = {
      sessionId,
      userId: row.userId,
      content: row.content,
      options: parseObject(row.optionsJson) ?? {},
      images: parseArray(row.imagesJson) ?? [],
    };
    const sentCell = sentCells.get(sessionId);
    if (sentCell?.version === row.updatedAt && sentCell.echoed) input.echoed = true;

    if (dependencies.checkSendLimit) {
      // «Send now» on the card the limit refused is the user's «run anyway».
      const confirmed = manual && limitRefused.get(sessionId) === row.updatedAt;
      if (!confirmed) {
        let reason: string | null = null;
        try {
          reason = await dependencies.checkSendLimit(input);
        } catch (error) {
          console.error('[QueuedMessages] limit check failed', { sessionId, error: error instanceof Error ? error.message : String(error) });
        }
        // The answer took a while. Someone else is sending, or the cell moved
        // on — whoever changed it (a put, a clear) decided for the new one.
        if (sending.has(sessionId)) return false;
        const fresh = db.get(sessionId);
        if (!fresh || fresh.updatedAt !== row.updatedAt) return false;
        if (reason) {
          hold(fresh, 'error', clip(reason, ERROR_MAX));
          const held = db.get(sessionId);
          if (held) limitRefused.set(sessionId, held.updatedAt);
          return false;
        }
      }
      input.options = { ...input.options, usageGuardOverride: true };
    }

    sending.add(sessionId);
    try {
      let outcome: QueuedSendOutcome;
      try {
        outcome = await dependencies.sendAsUser(input);
      } catch (error) {
        // The reason is the gateway's own error text, never the message.
        const reason = error instanceof Error ? error.message : String(error);
        outcome = { started: false, busy: false, error: `Не удалось отправить сообщение: ${reason}` };
      }

      if (outcome.started) {
        // Only the version that was sent: an edit made meanwhile stays queued.
        if (db.remove(sessionId, row.updatedAt)) forget(sessionId);
        log('queue_send', { sessionId, userId: row.userId, manual });
        notify(sessionId);
        return true;
      }

      const current = db.get(sessionId);
      if (!current || current.updatedAt !== row.updatedAt) {
        // Removed or edited while the gateway answered: that is a new message.
        return false;
      }
      if (outcome.busy) {
        // Someone's run took the chat first: wait for its end, like any queued message.
        liftHold(current);
        return false;
      }
      hold(current, 'error', clip(outcome.error || 'Не удалось отправить сообщение', ERROR_MAX));
      return false;
    } finally {
      sending.delete(sessionId);
    }
  }

  function readPut(input: QueuedPutInput): CellContent {
    const raw = input as { content?: unknown; options?: unknown; images?: unknown } | null | undefined;
    if (typeof raw?.content !== 'string') {
      throw badRequest('content должен быть строкой');
    }
    if (raw.content.length > QUEUED_CONTENT_MAX) {
      throw badRequest('Сообщение слишком длинное для очереди', 'QUEUED_MESSAGE_TOO_LONG');
    }
    if (raw.options !== undefined && raw.options !== null && (typeof raw.options !== 'object' || Array.isArray(raw.options))) {
      throw badRequest('options должен быть объектом');
    }
    if (raw.images !== undefined && raw.images !== null && !Array.isArray(raw.images)) {
      throw badRequest('images должен быть списком');
    }
    const images = (raw.images as unknown[] | null | undefined) ?? [];
    if (images.length > QUEUED_IMAGES_MAX) {
      throw badRequest('Слишком много вложений для очереди', 'QUEUED_MESSAGE_TOO_LONG');
    }
    if (!raw.content.trim() && images.length === 0) {
      throw badRequest('Пустое сообщение в очередь не ставится', 'QUEUED_MESSAGE_EMPTY');
    }
    const optionsJson = raw.options ? JSON.stringify(raw.options) : null;
    if (optionsJson && optionsJson.length > OPTIONS_JSON_MAX) {
      throw badRequest('Параметры отправки слишком большие', 'QUEUED_MESSAGE_TOO_LONG');
    }
    return {
      content: raw.content,
      optionsJson,
      imagesJson: images.length > 0 ? JSON.stringify(images) : null,
      images: images.length,
    };
  }

  return {
    get(sessionId: string): QueuedMessage | null {
      const row = db.get(sessionId);
      return row ? toQueued(row) : null;
    },

    /**
     * Queues the message (replacing the chat's queued one). With no live run
     * and no open question the turn is already over — it is sent at once.
     */
    async put(sessionId: string, userId: number | null, input: QueuedPutInput): Promise<{ queued: QueuedMessage | null; sent: boolean }> {
      const message = readPut(input);
      const row = db.put({
        sessionId,
        userId,
        content: message.content,
        optionsJson: message.optionsJson,
        imagesJson: message.imagesJson,
        at: stamp(),
      });
      forget(sessionId);
      const live = dependencies.isRunLive(sessionId);
      const waiting = dependencies.getAttention(sessionId)?.state === 'waiting';
      log('queue_put', { sessionId, userId, chars: message.content.length, images: message.images, live });

      const announcedBefore = notifications;
      if (waiting) {
        hold(row, 'question');
      } else if (!live && await trySend(row, false)) {
        return { queued: null, sent: true };
      }
      // Every put is announced once, whatever happened to the cell after it.
      if (notifications === announcedBefore) notify(sessionId);

      const current = db.get(sessionId);
      return { queued: current ? toQueued(current) : null, sent: false };
    },

    /**
     * Keeps a message that was SENT (`chat.send`) while the chat's live
     * process could not take it: its input is already released, the agent
     * started a turn by itself, or the sender may not share that process. The
     * tab has emptied its field and drawn the bubble — a refusal would lose
     * the message. It leaves when that turn or run ends (the gateway's turn
     * boundary and `complete` come to `handleAttentionChange`), also when the
     * chat «ждёт тебя». Nothing is sent from here: the gateway has just
     * refused it. Synchronous, like the `chat.send` it stands in for.
     *
     * The cell already holds a message → nothing is replaced: both texts stay,
     * the queued one first, with the settings of the newer one. A hold only
     * the user lifts stays, and the user sends them.
     */
    deferSent(sessionId: string, userId: number | null, input: QueuedPutInput): QueuedMessage {
      const message = readPut(input);
      const existing = db.get(sessionId);
      let cell = message;
      if (existing) {
        const images = [...(parseArray(existing.imagesJson) ?? []), ...(parseArray(message.imagesJson) ?? [])];
        cell = readPut({
          content: [existing.content, message.content].filter((text) => text.trim()).join('\n\n'),
          options: parseObject(message.optionsJson),
          images,
        });
      }
      const row = db.put({
        sessionId,
        userId,
        content: cell.content,
        optionsJson: cell.optionsJson,
        imagesJson: cell.imagesJson,
        at: stamp(),
      });
      forget(sessionId);
      log('queue_put', { sessionId, userId, chars: cell.content.length, images: cell.images, live: true });
      if (existing?.holdReason && STICKY_HOLDS.has(existing.holdReason)) {
        db.setHold(sessionId, { holdReason: existing.holdReason, lastError: existing.lastError, at: stamp() });
      } else {
        // Only the lone message is on the sender's screen as it will be sent.
        sentCells.set(sessionId, { version: row.updatedAt, echoed: !existing });
      }
      notify(sessionId);
      return toQueued(db.get(sessionId) ?? row);
    },

    /** Removes the queued message. False = the chat had none. */
    clear(sessionId: string): boolean {
      const removed = db.remove(sessionId);
      if (removed) {
        forget(sessionId);
        notify(sessionId);
      }
      return removed;
    },

    /**
     * «Отправить сейчас»: a live turn is stopped by the server and the message
     * is sent after the stop; with no live turn it is sent at once — whatever
     * hold it had. Works with no tab left: nothing here waits for a client.
     */
    async sendNow(sessionId: string, userId: number | null): Promise<{ queued: QueuedMessage | null; sent: boolean }> {
      if (!db.get(sessionId)) {
        throw new AppError('В очереди этого чата нет сообщения', { statusCode: 404, code: 'QUEUED_MESSAGE_NOT_FOUND' });
      }

      if (dependencies.isRunLive(sessionId)) {
        // The mark tells handleAttentionChange that this «Стоп» is ours.
        db.setSendNow(sessionId, true);
        try {
          await dependencies.abortRun(sessionId, userId);
        } finally {
          db.setSendNow(sessionId, false);
        }
      }

      const row = db.get(sessionId);
      if (!row) {
        // Removed while the turn was being stopped.
        return { queued: null, sent: false };
      }
      const sent = await trySend(row, true);
      const current = sent ? null : db.get(sessionId);
      return { queued: current ? toQueued(current) : null, sent };
    },

    /** The chat's status changed (subscribed to `sessionAttention.onChange`). */
    async handleAttentionChange(sessionId: string): Promise<void> {
      try {
        const row = db.get(sessionId);
        if (!row) return;
        const attention = dependencies.getAttention(sessionId);
        if (!attention) return;
        const sticky = row.holdReason !== null && STICKY_HOLDS.has(row.holdReason);
        // A kept `chat.send` is the user's answer: an open question does not hold it.
        const sentAlready = sentCells.get(sessionId)?.version === row.updatedAt;

        if (attention.state === 'working') {
          // The question was answered and the agent works on: the message goes with the turn end again.
          if (row.holdReason === 'question') liftHold(row);
          // «Ждёт помощников»: the turn is over, only the status does not say
          // so — the message goes into the live process now.
          if (!sticky && dependencies.runPhase?.(sessionId) === 'waiting_helpers') {
            const current = db.get(sessionId);
            if (current) await trySend(current, false);
          }
          return;
        }
        if (sticky) return;

        if (attention.state === 'waiting' && !sentAlready) {
          if (row.holdReason !== 'question') hold(row, 'question');
          return;
        }
        if (attention.state === 'failed') {
          hold(row, 'failed');
          return;
        }

        // done — or a sent message of a chat that asks: it goes when no turn is going
        if (attention.stopped) {
          // «Send now» stops the turn itself and sends when the stop has settled.
          if (!row.sendNow) hold(row, 'stopped');
          return;
        }
        if (dependencies.isRunLive(sessionId)) {
          // A new run already took the chat; its end comes here again.
          return;
        }
        await trySend(row, false);
      } catch (error) {
        // The queue must never break the status flow it listens to.
        console.error('[QueuedMessages] status change failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    /**
     * Server start: the runs of the previous process are gone, so whatever is
     * queued stays in its card and waits for the user. Returns how many.
     */
    recoverOnBoot(): number {
      const rows = db.list();
      if (rows.length === 0) return 0;
      const held = db.holdAll('restart', stamp());
      for (const row of rows) {
        log('queue_hold', { sessionId: row.sessionId, userId: row.userId, reason: 'restart' });
        notify(row.sessionId);
      }
      return held;
    },
  };
}

export type QueuedMessagesService = ReturnType<typeof createQueuedMessagesService>;

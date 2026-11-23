/**
 * «Очередь сообщений»: the one message a chat holds while its agent is busy.
 * Kept and sent by the server (`server/modules/queued-messages/`), so it does
 * not depend on an open tab. No database, no Node APIs: the client imports
 * this file too.
 */

/**
 * Why a queued message is not going out by itself:
 * - `question` — the agent waits for the user's answer or a permission;
 * - `stopped`  — the turn was stopped with «Стоп»;
 * - `failed`   — the turn ended with an engine error;
 * - `restart`  — the server restarted while the message was queued;
 * - `error`    — sending it failed (see `lastError`).
 */
export type QueuedHoldReason = 'question' | 'stopped' | 'failed' | 'restart' | 'error';

export const QUEUED_HOLD_REASONS: readonly QueuedHoldReason[] = ['question', 'stopped', 'failed', 'restart', 'error'];

export type QueuedMessage = {
  sessionId: string;
  content: string;
  options?: Record<string, unknown>;
  images?: unknown[];
  /** ISO time the message was first queued. */
  createdAt: string;
  /** ISO time of its last change (edit, hold, error). */
  updatedAt: string;
  /** null = goes out by itself when the turn ends. */
  holdReason: QueuedHoldReason | null;
  /** Text for a person; only with `holdReason: 'error'`. */
  lastError: string | null;
};

/** Content-free websocket frame: «re-read GET /api/sessions/:id/queued-message». Not a chat row. */
export const QUEUED_MESSAGE_CHANGED = 'queued_message_changed';

export type QueuedMessageChangedFrame = {
  kind: typeof QUEUED_MESSAGE_CHANGED;
  sessionId: string;
};

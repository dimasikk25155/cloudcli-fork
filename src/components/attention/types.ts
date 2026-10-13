/**
 * Client view of the "Ждут тебя" API (`GET /api/attention`).
 *
 * Mirrors `AttentionItem` / `AttentionDetail` from
 * `server/modules/session-attention/session-attention.service.ts`. The client
 * only ever reads these through the HTTP API — the websocket frame
 * `attention_changed` carries no content, just "re-read now".
 */

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

export type AttentionQuestion = {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect: boolean;
};

export type AttentionDetail = {
  question?: string;
  options?: string[];
  questions?: AttentionQuestion[];
  requestId?: string;
  toolName?: string;
  error?: string;
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
  /** ISO timestamp of the last state change. */
  updatedAt: string;
  /** done/failed only: changed after this user last looked at the session. */
  unread: boolean;
  /** Session's model override; null/absent = account default. */
  model?: string | null;
  /** ISO time of the session's last model output (prompt-cache timer); null/absent = unknown. */
  lastModelAt?: string | null;
}

export type AttentionCounts = {
  waiting: number;
  /** Unread failures only. */
  failed: number;
  unreadDone: number;
  working: number;
};

export type AttentionSeenTarget = { sessionIds: string[] } | { all: true };

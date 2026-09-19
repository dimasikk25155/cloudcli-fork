/**
 * Writing to the audit log.
 *
 * The one rule this module lives by: **recording must never break the thing it
 * records**. Every write is wrapped, failures degrade to console.error, and a
 * missing audit row is always preferable to a run that died because logging
 * threw. Anything that must not fail open belongs in a gate, not here.
 */

import crypto from 'crypto';

import {
  auditDb,
  type AppendAuditInput,
  type AuditActor,
  type AuditEvent,
  type AuditOutcome,
  type AuditRow,
} from '@/modules/database/index.js';
import { moscowDay } from '@/shared/moscow-day.js';
import { scrubSecrets } from '@/shared/secret-scrub.js';

/** Detail is a preview for humans, not a transcript. Keep rows small. */
const MAX_DETAIL_LENGTH = 2000;

export type RecordAuditInput = {
  actor: AuditActor;
  event: AuditEvent;
  userId?: number | null;
  projectId?: string | null;
  projectPath?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  provider?: string | null;
  model?: string | null;
  toolName?: string | null;
  detail?: string | null;
  outcome?: AuditOutcome | null;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  costMicroUsd?: number;
  durationMs?: number | null;
};

/** Identifier for one run, shared by every row that run produces. */
export function newRunId(): string {
  return crypto.randomUUID();
}

/** Dollars → integer micro-USD, the unit the table stores. */
export function toMicroUsd(usd: number | null | undefined): number {
  if (!Number.isFinite(usd as number)) return 0;
  return Math.round((usd as number) * 1_000_000);
}

/** Integer micro-USD → dollars, for display. */
export function fromMicroUsd(microUsd: number | null | undefined): number {
  if (!Number.isFinite(microUsd as number)) return 0;
  return (microUsd as number) / 1_000_000;
}

function prepareDetail(detail: string | null | undefined): string {
  if (!detail) return '';
  // Scrub first, then truncate: truncating first could cut a token in half and
  // leave a fragment the patterns no longer recognise.
  const { text } = scrubSecrets(detail);
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

/**
 * Appends one row. Returns the row, null when it was a duplicate `run.finish`,
 * and null when the write failed.
 *
 * Callers are not expected to check the result — this is fire-and-forget by
 * design.
 */
export function recordAuditEvent(input: RecordAuditInput): AuditRow | null {
  try {
    const ts = new Date().toISOString();
    const payload: AppendAuditInput = {
      ts,
      dayMsk: moscowDay(ts),
      userId: input.userId ?? null,
      actor: input.actor,
      projectId: input.projectId ?? null,
      projectPath: input.projectPath ?? null,
      sessionId: input.sessionId ?? null,
      runId: input.runId ?? null,
      event: input.event,
      provider: input.provider ?? null,
      model: input.model ?? null,
      toolName: input.toolName ?? null,
      detail: prepareDetail(input.detail),
      outcome: input.outcome ?? null,
      tokensIn: input.tokensIn ?? 0,
      tokensOut: input.tokensOut ?? 0,
      cacheRead: input.cacheRead ?? 0,
      cacheWrite5m: input.cacheWrite5m ?? 0,
      cacheWrite1h: input.cacheWrite1h ?? 0,
      costMicroUsd: input.costMicroUsd ?? 0,
      durationMs: input.durationMs ?? null,
    };

    return auditDb.appendEvent(payload);
  } catch (err: any) {
    console.error('audit: could not record event', {
      event: input.event,
      actor: input.actor,
      error: err?.message,
    });
    return null;
  }
}

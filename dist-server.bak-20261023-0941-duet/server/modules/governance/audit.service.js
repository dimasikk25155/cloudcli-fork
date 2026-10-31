/**
 * Writing to the audit log.
 *
 * The one rule this module lives by: **recording must never break the thing it
 * records**. Every write is wrapped, failures degrade to console.error, and a
 * missing audit row is always preferable to a run that died because logging
 * threw. Anything that must not fail open belongs in a gate, not here.
 */
import crypto from 'crypto';
import { auditDb, } from '../../modules/database/index.js';
import { moscowDay } from '../../shared/moscow-day.js';
import { scrubSecrets } from '../../shared/secret-scrub.js';
/** Detail is a preview for humans, not a transcript. Keep rows small. */
const MAX_DETAIL_LENGTH = 2000;
/** Identifier for one run, shared by every row that run produces. */
export function newRunId() {
    return crypto.randomUUID();
}
/** Dollars → integer micro-USD, the unit the table stores. */
export function toMicroUsd(usd) {
    if (!Number.isFinite(usd))
        return 0;
    return Math.round(usd * 1_000_000);
}
/** Integer micro-USD → dollars, for display. */
export function fromMicroUsd(microUsd) {
    if (!Number.isFinite(microUsd))
        return 0;
    return microUsd / 1_000_000;
}
function prepareDetail(detail) {
    if (!detail)
        return '';
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
export function recordAuditEvent(input) {
    try {
        const ts = new Date().toISOString();
        const payload = {
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
    }
    catch (err) {
        console.error('audit: could not record event', {
            event: input.event,
            actor: input.actor,
            error: err?.message,
        });
        return null;
    }
}
//# sourceMappingURL=audit.service.js.map
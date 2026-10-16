/**
 * What one run cost, accumulated while it happens.
 *
 * Deliberately NOT computed by re-reading the session transcript afterwards:
 * a transcript is hundreds of kilobytes and re-parsing it on every run
 * completion burns CPU proportional to session length. The usage numbers are
 * already flowing past in the SDK stream — this just adds them up.
 *
 * Two traps this module exists to avoid:
 *
 *  1. `extractTokenBudget()` in claude-sdk.js sums fresh input, cache reads and
 *     cache writes into a single `inputTokens`. That is right for the context
 *     badge and wrong for money: cache reads bill at 0.1x and cache writes at
 *     1.25x/2x. Billing that blended number as fresh input overstates the cost
 *     by roughly 10x. So we read the raw usage fields.
 *
 *  2. `message.usage` arrives on every assistant step and can be repeated in
 *     the terminal `result` message. Without de-duplication by `message.id`
 *     a run bills its last step twice.
 */
import { EMPTY_BREAKDOWN, estimateCostUsd, readUsageBreakdown, } from '../../shared/token-pricing.js';
/**
 * Accumulates token usage across one run.
 *
 * Usage-free messages are ignored, so it is safe to feed it the entire stream.
 */
export class RunMeter {
    seenMessageIds = new Set();
    breakdown = { ...EMPTY_BREAKDOWN };
    model = null;
    /** Set by the last usage row; 'fast' selects premium Opus rates. */
    speed = null;
    /**
     * Folds one SDK stream message into the total.
     * Returns true when the message actually contributed usage.
     */
    addMessage(sdkMessage) {
        if (!sdkMessage || typeof sdkMessage !== 'object')
            return false;
        const usage = sdkMessage.message?.usage ?? sdkMessage.usage;
        if (!usage || typeof usage !== 'object')
            return false;
        // De-duplicate by message id. Messages without an id (some result frames)
        // are keyed by nothing and would double-count, so they are skipped when a
        // priced message already covered this step.
        const messageId = sdkMessage.message?.id ?? sdkMessage.id ?? null;
        if (typeof messageId === 'string') {
            if (this.seenMessageIds.has(messageId))
                return false;
            this.seenMessageIds.add(messageId);
        }
        else if (this.seenMessageIds.size > 0) {
            return false;
        }
        const model = sdkMessage.message?.model ?? sdkMessage.model ?? null;
        if (typeof model === 'string' && model) {
            this.model = model;
        }
        const speed = usage.speed ?? sdkMessage.message?.speed ?? null;
        if (typeof speed === 'string' && speed) {
            this.speed = speed;
        }
        const row = readUsageBreakdown(usage);
        this.breakdown = {
            inputTokens: this.breakdown.inputTokens + row.freshInput,
            outputTokens: this.breakdown.outputTokens + row.output,
            cacheReadTokens: this.breakdown.cacheReadTokens + row.cacheRead,
            cacheWrite5mTokens: this.breakdown.cacheWrite5mTokens + row.cacheWrite5m,
            cacheWrite1hTokens: this.breakdown.cacheWrite1hTokens + row.cacheWrite1h,
        };
        return true;
    }
    /** True when nothing priceable was ever seen. */
    isEmpty() {
        const b = this.breakdown;
        return (b.inputTokens === 0 &&
            b.outputTokens === 0 &&
            b.cacheReadTokens === 0 &&
            b.cacheWrite5mTokens === 0 &&
            b.cacheWrite1hTokens === 0);
    }
    /**
     * Final cost for the run.
     *
     * `costUsd` is null for engines we have no published rates for (Kimi, Gemini
     * and friends). Grok uses the published xAI API rates as an equivalent, even
     * though SuperGrok is a subscription. An absent price is honest, a guessed
     * one is not.
     */
    finish() {
        const estimate = estimateCostUsd(this.breakdown, this.model, { speed: this.speed });
        return {
            breakdown: { ...this.breakdown },
            model: this.model,
            costUsd: estimate ? estimate.totalUsd : null,
            costMicroUsd: estimate ? Math.round(estimate.totalUsd * 1_000_000) : 0,
        };
    }
}
//# sourceMappingURL=metering.js.map
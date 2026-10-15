/**
 * Reading the audit log back as money.
 *
 * Nothing here blocks anything — this release only makes spend visible. The
 * shapes returned are the ones a spend cap will later compare against, so that
 * when the cap arrives it reads the same numbers the panel has been showing.
 */
import { auditDb } from '../../modules/database/index.js';
import { fromMicroUsd } from '../../modules/governance/audit.service.js';
import { moscowDaysBack, moscowToday } from '../../shared/moscow-day.js';
/** "This week" = a rolling 7 Moscow days including today. */
const WEEK_DAYS = 7;
function toRunSummary(row) {
    return {
        runId: row.run_id,
        ts: row.ts,
        actor: row.actor,
        projectPath: row.project_path,
        model: row.model,
        provider: row.provider,
        usd: fromMicroUsd(row.cost_micro_usd),
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        outcome: row.outcome,
    };
}
/**
 * Spend for one user, optionally narrowed to a project.
 *
 * Scoped by user on purpose: on a shared instance a tenant has no business
 * seeing what other tenants burned.
 */
export function getSpendSummary(options) {
    const today = moscowToday();
    const weekDays = moscowDaysBack(WEEK_DAYS);
    const scope = { userId: options.userId, projectId: options.projectId };
    const todayTotals = auditDb.sumSpend([today], scope);
    const weekTotals = auditDb.sumSpend(weekDays, scope);
    return {
        day: today,
        today: {
            usd: fromMicroUsd(todayTotals.costMicroUsd),
            tokensIn: todayTotals.tokensIn,
            tokensOut: todayTotals.tokensOut,
            runs: todayTotals.runs,
        },
        week: {
            usd: fromMicroUsd(weekTotals.costMicroUsd),
            tokensIn: weekTotals.tokensIn,
            tokensOut: weekTotals.tokensOut,
            runs: weekTotals.runs,
        },
        topRuns: auditDb.topRuns(weekDays, scope, 5).map(toRunSummary),
        byProject: auditDb
            .spendByProject(weekDays, { userId: options.userId })
            .map((entry) => ({
            projectId: entry.projectId,
            projectPath: entry.projectPath,
            usd: fromMicroUsd(entry.costMicroUsd),
            tokensIn: entry.tokensIn,
            tokensOut: entry.tokensOut,
            runs: entry.runs,
        })),
    };
}
//# sourceMappingURL=spend.service.js.map
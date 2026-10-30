/**
 * Grok Build session files on disk: context fill lives in signals.json,
 * per-turn spend lives in updates.jsonl (`turn_completed.usage`).
 *
 * chat_history.jsonl has no usage counters — do not scan it for tokens.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { getContextWindow, readUsageBreakdown, } from './token-pricing.js';
function grokHome() {
    const fromEnv = process.env.GROK_HOME?.trim();
    return fromEnv || path.join(os.homedir(), '.grok');
}
export function grokSessionDir(workingDir, sessionUuid) {
    return path.join(grokHome(), 'sessions', encodeURIComponent(workingDir), sessionUuid);
}
export function grokSessionsRoot() {
    return path.join(grokHome(), 'sessions');
}
function grokTsToIso(value) {
    if (typeof value === 'string' && value) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return new Date(parsed).toISOString();
        }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value < 1e12 ? value * 1000 : value;
        return new Date(ms).toISOString();
    }
    return new Date().toISOString();
}
export function readGrokContextBudget(workingDir, sessionUuid, model) {
    const dir = grokSessionDir(workingDir, sessionUuid);
    return readGrokContextBudgetFromDir(dir, model);
}
export function readGrokContextBudgetFromDir(sessionDir, model) {
    try {
        const raw = fs.readFileSync(path.join(sessionDir, 'signals.json'), 'utf8');
        const sig = JSON.parse(raw);
        const used = sig.contextTokensUsed;
        if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) {
            return null;
        }
        const recordedWindow = Number(sig.contextWindowTokens);
        const recordedModel = typeof sig.primaryModelId === 'string' ? sig.primaryModelId : null;
        const total = (Number.isFinite(recordedWindow) && recordedWindow > 0)
            ? recordedWindow
            : getContextWindow(recordedModel || model) || 500_000;
        return { used, total, model: recordedModel || model || null };
    }
    catch {
        return null;
    }
}
export async function scanGrokTurnUsage(updatesPath) {
    const turns = [];
    let stream = null;
    try {
        stream = fs.createReadStream(updatesPath);
    }
    catch {
        return turns;
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line.trim()) {
            continue;
        }
        let entry;
        try {
            entry = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const record = entry;
        const params = record.params && typeof record.params === 'object'
            ? record.params
            : null;
        const update = params?.update && typeof params.update === 'object'
            ? params.update
            : null;
        if (update?.sessionUpdate !== 'turn_completed') {
            continue;
        }
        const usage = update.usage && typeof update.usage === 'object'
            ? update.usage
            : null;
        if (!usage) {
            continue;
        }
        const modelUsage = usage.modelUsage && typeof usage.modelUsage === 'object'
            ? usage.modelUsage
            : null;
        const model = modelUsage ? Object.keys(modelUsage)[0] ?? null : null;
        turns.push({
            iso: grokTsToIso(record.timestamp),
            model,
            breakdown: readUsageBreakdown(usage),
        });
    }
    return turns;
}
export async function listGrokSessionDirs() {
    const root = grokSessionsRoot();
    let cwdDirs = [];
    try {
        cwdDirs = await fsp.readdir(root);
    }
    catch {
        return [];
    }
    const found = [];
    for (const cwdSlug of cwdDirs) {
        const cwdDir = path.join(root, cwdSlug);
        let sessionIds = [];
        try {
            const stat = await fsp.stat(cwdDir);
            if (!stat.isDirectory()) {
                continue;
            }
            sessionIds = await fsp.readdir(cwdDir);
        }
        catch {
            continue;
        }
        let projectPath = null;
        try {
            projectPath = decodeURIComponent(cwdSlug);
        }
        catch {
            projectPath = cwdSlug;
        }
        for (const sessionId of sessionIds) {
            const dir = path.join(cwdDir, sessionId);
            try {
                const stat = await fsp.stat(dir);
                if (!stat.isDirectory()) {
                    continue;
                }
                found.push({ dir, sessionId, projectPath, mtimeMs: stat.mtimeMs });
            }
            catch {
                continue;
            }
        }
    }
    return found;
}
//# sourceMappingURL=grok-usage.js.map
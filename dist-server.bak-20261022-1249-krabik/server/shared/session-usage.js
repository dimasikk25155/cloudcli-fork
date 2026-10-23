import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { sessionsDb } from '../modules/database/index.js';
import { readClaudeContextBudget, isContextCompaction } from './context-budget.js';
import { moscowDay } from './moscow-day.js';
import { grokSessionsRoot, listGrokSessionDirs, readGrokContextBudgetFromDir, scanGrokTurnUsage, } from './grok-usage.js';
import { estimateCostUsd, getContextWindow, readCacheCreationSplit, } from './token-pricing.js';
/** Conservative window used until the transcript reveals the real model. */
const FALLBACK_WINDOW = 200_000;
/**
 * The human session title the sidebar shows, resolved from the DB `custom_name`
 * the session synchronizer already persists (AI/first-message title or a manual
 * rename). Placeholder/untitled names collapse to null so the UI can fall back
 * to the project name. Never throws — an unready DB just yields no title.
 */
function resolveSessionTitle(diskSessionId) {
    try {
        const row = sessionsDb.getSessionByProviderSessionId(diskSessionId) ??
            sessionsDb.getSessionById(diskSessionId);
        const name = row?.custom_name?.trim();
        if (!name || name === 'Untitled Claude Session' || name === diskSessionId) {
            return null;
        }
        return name;
    }
    catch {
        return null;
    }
}
/** Row label for collapsed `agent-*.jsonl` sub-agent streams. */
const SUBAGENT_TITLE = 'Субагенты';
const CACHE_TTL_MS = 60_000;
// Only scan sessions touched within this window; older transcripts stay off
// the hot path so a request never walks the entire history on disk.
const MAX_AGE_DAYS = 30;
let cached = null;
function claudeProjectsDir() {
    return path.join(os.homedir(), '.claude', 'projects');
}
/** Model key for rows whose transcript never named one. */
const UNKNOWN_MODEL = '';
function emptyBucket(lastActivity) {
    return { tokens: 0, output: 0, lastActivity, byModel: new Map() };
}
function sliceFor(bucket, model) {
    let slice = bucket.byModel.get(model);
    if (!slice) {
        slice = {
            tokens: 0,
            breakdown: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWrite5mTokens: 0,
                cacheWrite1hTokens: 0,
            },
            speed: null,
        };
        bucket.byModel.set(model, slice);
    }
    return slice;
}
/** Model that carried most of a bucket's tokens — what the row displays. */
function dominantModel(bucket) {
    let best = null;
    let bestTokens = -1;
    for (const [model, slice] of bucket.byModel) {
        if (model !== UNKNOWN_MODEL && slice.tokens > bestTokens) {
            best = model;
            bestTokens = slice.tokens;
        }
    }
    return best;
}
/** Sum of per-model estimates; null only when nothing at all was priceable. */
function bucketCostUsd(bucket) {
    let total = 0;
    let priced = false;
    for (const [model, slice] of bucket.byModel) {
        const estimate = estimateCostUsd(slice.breakdown, model || null, { speed: slice.speed });
        if (estimate) {
            total += estimate.totalUsd;
            priced = true;
        }
    }
    return priced ? total : null;
}
/**
 * Streams one transcript file and folds every `message.usage` row into
 * per-Moscow-day buckets, counting each `message.id` once (see DEDUPLICATION).
 *
 * Attribution is per row, by that row's own timestamp — a session worked on
 * past midnight splits across both days instead of being dumped wholesale into
 * the day it happened to end on.
 */
async function scanSessionFile(filePath, fallbackIso) {
    const acc = { projectPath: null, byDay: new Map() };
    const seenMessageIds = new Set();
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
    });
    for await (const line of rl) {
        if (!line.trim()) {
            continue;
        }
        try {
            const entry = JSON.parse(line);
            // A session belongs to the folder it STARTED in. cwd changes mid-run
            // (sub-agents, a dive into cloudcli-fork or the vault), and last-wins
            // handed the session — with its tokens and cost — to whatever folder it
            // happened to end in: 59 of this project's sessions were billed to
            // cloudcli-fork before this.
            if (typeof entry.cwd === 'string' && entry.cwd && !acc.projectPath) {
                acc.projectPath = entry.cwd;
            }
            const usage = entry.message?.usage;
            if (!usage) {
                continue;
            }
            // One assistant turn spans several transcript rows that repeat the same
            // usage object; bill it once. Rows without an id (synthetic/edge) are
            // counted as-is — they carry no duplicate to collapse.
            const messageId = typeof entry.message?.id === 'string' ? entry.message.id : null;
            if (messageId !== null && seenMessageIds.has(messageId)) {
                continue;
            }
            if (messageId) {
                seenMessageIds.add(messageId);
            }
            const iso = typeof entry.timestamp === 'string' ? entry.timestamp : fallbackIso;
            const day = moscowDay(iso);
            let bucket = acc.byDay.get(day);
            if (!bucket) {
                bucket = emptyBucket(iso);
                acc.byDay.set(day, bucket);
            }
            const input = usage.input_tokens || 0;
            const output = usage.output_tokens || 0;
            const cacheRead = usage.cache_read_input_tokens || 0;
            const { cacheWrite5mTokens, cacheWrite1hTokens } = readCacheCreationSplit(usage);
            const rowTokens = input + output + cacheRead + cacheWrite5mTokens + cacheWrite1hTokens;
            bucket.tokens += rowTokens;
            bucket.output += output;
            bucket.lastActivity = iso;
            // Price this row against the model that actually produced it.
            const rowModel = typeof entry.message?.model === 'string' && entry.message.model !== '<synthetic>'
                ? entry.message.model
                : UNKNOWN_MODEL;
            const slice = sliceFor(bucket, rowModel);
            slice.tokens += rowTokens;
            slice.breakdown.inputTokens += input;
            slice.breakdown.outputTokens += output;
            slice.breakdown.cacheReadTokens += cacheRead;
            slice.breakdown.cacheWrite5mTokens += cacheWrite5mTokens;
            slice.breakdown.cacheWrite1hTokens += cacheWrite1hTokens;
            if (typeof usage.speed === 'string') {
                slice.speed = usage.speed;
            }
        }
        catch {
            // Skip malformed lines that can happen during concurrent writes.
        }
    }
    return acc;
}
/** Deep enough for `<session>/subagents/workflows/<run>/agent-*.jsonl`. */
const MAX_TRANSCRIPT_DEPTH = 6;
/**
 * Every transcript under one project folder, including nested sub-agent runs.
 *
 * Sub-agent streams live at `<session-id>/subagents/workflows/<run>/agent-*.jsonl`,
 * so a flat readdir missed them entirely — 36M tokens in a single measured day.
 * The first path segment names the parent session, which is what makes it
 * possible to bill a sub-agent's burn to the session that spawned it.
 */
async function collectTranscripts(projectDir) {
    const found = [];
    const walk = async (current, depth) => {
        if (depth > MAX_TRANSCRIPT_DEPTH) {
            return;
        }
        let entries = [];
        try {
            entries = await fsp.readdir(current, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(full, depth + 1);
                continue;
            }
            if (!entry.name.endsWith('.jsonl')) {
                continue;
            }
            const segments = path.relative(projectDir, full).split(path.sep);
            if (segments.length === 1) {
                found.push({
                    filePath: full,
                    sessionId: entry.name.replace(/\.jsonl$/, ''),
                    isSubAgent: entry.name.startsWith('agent-'),
                });
            }
            else {
                // Nested: the first segment is the parent session's id.
                found.push({ filePath: full, sessionId: segments[0], isSubAgent: true });
            }
        }
    };
    await walk(projectDir, 0);
    return found;
}
/**
 * Builds the day → sessions token history, newest day first and heaviest
 * session first within each day. Cached for a minute so repeated modal opens
 * don't re-walk the transcripts.
 */
export async function getSessionUsageHistory() {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.days;
    }
    const dir = claudeProjectsDir();
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
    let projectDirs = [];
    try {
        projectDirs = await fsp.readdir(dir);
    }
    catch {
        // No Claude transcripts — still scan Grok sessions below.
        projectDirs = [];
    }
    // Keyed by `${sessionId}::${day}` so a session's own transcript and every
    // sub-agent it spawned fold into one row per day.
    const rows = new Map();
    // Same key → model → tokens, so the displayed model is the one that actually
    // carried the row after parent and sub-agent files are merged.
    const rowModelTokens = new Map();
    for (const slug of projectDirs) {
        const projectDir = path.join(dir, slug);
        try {
            const stat = await fsp.stat(projectDir);
            if (!stat.isDirectory()) {
                continue;
            }
        }
        catch {
            continue;
        }
        for (const { filePath, sessionId, isSubAgent } of await collectTranscripts(projectDir)) {
            let mtimeMs = 0;
            try {
                mtimeMs = (await fsp.stat(filePath)).mtimeMs;
            }
            catch {
                continue;
            }
            if (mtimeMs < cutoff) {
                continue;
            }
            const fallbackIso = new Date(mtimeMs).toISOString();
            let acc;
            try {
                acc = await scanSessionFile(filePath, fallbackIso);
            }
            catch {
                continue;
            }
            const projectPath = acc.projectPath;
            const project = projectPath
                ? path.basename(projectPath)
                // Fall back to the encoded folder slug when the transcript never
                // recorded a cwd (older/edge transcripts).
                : slug.replace(/^-/, '').split('-').pop() || slug;
            // One row per day the session actually ran, so a session that spanned
            // midnight is attributed to both days rather than only its last one.
            for (const [day, bucket] of acc.byDay) {
                if (bucket.tokens <= 0) {
                    continue;
                }
                const costUsd = bucketCostUsd(bucket);
                const key = `${sessionId}::${day}`;
                const existing = rows.get(key);
                let modelTally = rowModelTokens.get(key);
                if (!modelTally) {
                    modelTally = new Map();
                    rowModelTokens.set(key, modelTally);
                }
                for (const [model, slice] of bucket.byModel) {
                    if (model !== UNKNOWN_MODEL) {
                        modelTally.set(model, (modelTally.get(model) ?? 0) + slice.tokens);
                    }
                }
                if (!existing) {
                    rows.set(key, {
                        day,
                        project,
                        projectPath,
                        sessionId,
                        title: resolveSessionTitle(sessionId) ?? (isSubAgent ? SUBAGENT_TITLE : null),
                        tokens: bucket.tokens,
                        output: bucket.output,
                        model: dominantModel(bucket),
                        lastActivity: bucket.lastActivity,
                        costUsd,
                    });
                    continue;
                }
                existing.tokens += bucket.tokens;
                existing.output += bucket.output;
                if (existing.costUsd !== null || costUsd !== null) {
                    existing.costUsd = (existing.costUsd ?? 0) + (costUsd ?? 0);
                }
                if (bucket.lastActivity > existing.lastActivity) {
                    existing.lastActivity = bucket.lastActivity;
                }
                // A sub-agent file rarely records the cwd; keep the parent's.
                existing.projectPath = existing.projectPath ?? projectPath;
                // Prefer a real session title over the sub-agent placeholder.
                if (existing.title === SUBAGENT_TITLE) {
                    existing.title = resolveSessionTitle(sessionId) ?? SUBAGENT_TITLE;
                }
            }
        }
    }
    for (const grokSession of await listGrokSessionDirs()) {
        if (grokSession.mtimeMs < cutoff) {
            continue;
        }
        const updatesPath = path.join(grokSession.dir, 'updates.jsonl');
        if (!fs.existsSync(updatesPath)) {
            continue;
        }
        let turns;
        try {
            turns = await scanGrokTurnUsage(updatesPath);
        }
        catch {
            continue;
        }
        if (turns.length === 0) {
            continue;
        }
        const projectPath = grokSession.projectPath;
        const project = projectPath ? path.basename(projectPath) : 'grok';
        const fallbackIso = new Date(grokSession.mtimeMs).toISOString();
        for (const turn of turns) {
            const row = turn.breakdown;
            const input = row.freshInput + row.cacheRead + row.cacheWrite5m + row.cacheWrite1h;
            const tokens = input + row.output;
            if (tokens <= 0) {
                continue;
            }
            const iso = turn.iso || fallbackIso;
            const day = moscowDay(iso);
            const bucket = emptyBucket(iso);
            bucket.tokens = tokens;
            bucket.output = row.output;
            bucket.lastActivity = iso;
            const rowModel = turn.model || UNKNOWN_MODEL;
            const slice = sliceFor(bucket, rowModel);
            slice.tokens = tokens;
            slice.breakdown.inputTokens = row.freshInput;
            slice.breakdown.outputTokens = row.output;
            slice.breakdown.cacheReadTokens = row.cacheRead;
            slice.breakdown.cacheWrite5mTokens = row.cacheWrite5m;
            slice.breakdown.cacheWrite1hTokens = row.cacheWrite1h;
            const costUsd = bucketCostUsd(bucket);
            const key = `${grokSession.sessionId}::${day}`;
            const existing = rows.get(key);
            let modelTally = rowModelTokens.get(key);
            if (!modelTally) {
                modelTally = new Map();
                rowModelTokens.set(key, modelTally);
            }
            if (rowModel !== UNKNOWN_MODEL) {
                modelTally.set(rowModel, (modelTally.get(rowModel) ?? 0) + tokens);
            }
            if (!existing) {
                rows.set(key, {
                    day,
                    project,
                    projectPath,
                    sessionId: grokSession.sessionId,
                    title: resolveSessionTitle(grokSession.sessionId),
                    tokens,
                    output: row.output,
                    model: turn.model,
                    lastActivity: iso,
                    costUsd,
                });
                continue;
            }
            existing.tokens += tokens;
            existing.output += row.output;
            if (existing.costUsd !== null || costUsd !== null) {
                existing.costUsd = (existing.costUsd ?? 0) + (costUsd ?? 0);
            }
            if (iso > existing.lastActivity) {
                existing.lastActivity = iso;
            }
            existing.projectPath = existing.projectPath ?? projectPath;
        }
    }
    // Display the model that carried the most tokens once parent and sub-agent
    // files have been merged, rather than whichever file happened to land last.
    for (const [key, row] of rows) {
        const tally = rowModelTokens.get(key);
        if (!tally?.size) {
            continue;
        }
        row.model = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    const byDay = new Map();
    for (const session of rows.values()) {
        const day = session.day;
        const bucket = byDay.get(day);
        if (bucket) {
            bucket.push(session);
        }
        else {
            byDay.set(day, [session]);
        }
    }
    const days = [...byDay.entries()]
        .map(([day, daySessions]) => {
        const priced = daySessions.filter((session) => session.costUsd !== null);
        return {
            day,
            tokens: daySessions.reduce((sum, session) => sum + session.tokens, 0),
            costUsd: priced.length
                ? priced.reduce((sum, session) => sum + (session.costUsd ?? 0), 0)
                : null,
            sessions: daySessions.sort((a, b) => b.tokens - a.tokens),
        };
    })
        .sort((a, b) => (a.day < b.day ? 1 : -1));
    cached = { at: Date.now(), days };
    return days;
}
function kimiSessionsDir() {
    return path.join(os.homedir(), '.kimi-code', 'sessions');
}
/**
 * Locates the transcript file for a session without trusting any single id
 * space: the app-facing session id and the provider-native id are both tried,
 * first via the DB index, then by probing the conventional on-disk layouts.
 */
async function findSessionTranscript(sessionId, projectPath) {
    const candidates = new Set([sessionId]);
    try {
        const row = sessionsDb.resolveSessionRowForOverride(sessionId);
        if (row?.provider_session_id) {
            candidates.add(row.provider_session_id);
        }
        if (row?.jsonl_path && fs.existsSync(row.jsonl_path)) {
            return preferGrokUpdates(row.jsonl_path);
        }
        if (row?.project_path && !projectPath) {
            projectPath = row.project_path;
        }
    }
    catch {
        // An unready DB must not break the modal — fall through to disk probing.
    }
    // Claude engine: ~/.claude/projects/<encoded cwd>/<session>.jsonl
    if (projectPath) {
        const encoded = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
        for (const id of candidates) {
            const candidate = path.join(claudeProjectsDir(), encoded, `${id}.jsonl`);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    // Claude engine, project unknown: probe every project folder (cheap stat per dir).
    try {
        for (const slug of await fsp.readdir(claudeProjectsDir())) {
            for (const id of candidates) {
                const candidate = path.join(claudeProjectsDir(), slug, `${id}.jsonl`);
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }
    }
    catch {
        // No claude transcripts on this host.
    }
    // Kimi CLI: ~/.kimi-code/sessions/<wd_*>/session_<id>/agents/main/wire.jsonl
    try {
        for (const wdDir of await fsp.readdir(kimiSessionsDir())) {
            for (const id of candidates) {
                const candidate = path.join(kimiSessionsDir(), wdDir, `session_${id}`, 'agents', 'main', 'wire.jsonl');
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }
    }
    catch {
        // No kimi transcripts on this host.
    }
    // Grok CLI: ~/.grok/sessions/<urlencoded cwd>/<uuid>/updates.jsonl
    const grokRoot = grokSessionsRoot();
    if (projectPath) {
        for (const id of candidates) {
            const candidate = path.join(grokRoot, encodeURIComponent(projectPath), id, 'updates.jsonl');
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    try {
        for (const cwdSlug of await fsp.readdir(grokRoot)) {
            for (const id of candidates) {
                const candidate = path.join(grokRoot, cwdSlug, id, 'updates.jsonl');
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }
    }
    catch {
        // No grok transcripts on this host.
    }
    return null;
}
const readUsageNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
/** Grok's chat_history.jsonl has no usage. Spend lives in sibling updates.jsonl. */
function preferGrokUpdates(transcriptPath) {
    if (path.basename(transcriptPath) !== 'chat_history.jsonl') {
        return transcriptPath;
    }
    const updates = path.join(path.dirname(transcriptPath), 'updates.jsonl');
    return fs.existsSync(updates) ? updates : transcriptPath;
}
/**
 * Folds one transcript into the snapshot accumulator.
 *
 * `isSubAgent` files contribute tokens and cost but never the context reading:
 * a sub-agent runs its own context window, so letting it set `contextTokens`
 * would make the composer badge report someone else's fill level.
 */
async function foldGrokUpdates(filePath, acc, isSubAgent) {
    const turns = await scanGrokTurnUsage(filePath);
    for (const turn of turns) {
        const row = turn.breakdown;
        const input = row.freshInput + row.cacheRead + row.cacheWrite5m + row.cacheWrite1h;
        acc.inputTokens += input;
        acc.outputTokens += row.output;
        acc.cacheReadTokens += row.cacheRead;
        acc.cacheCreationTokens += row.cacheWrite5m + row.cacheWrite1h;
        const rowModel = turn.model || acc.model || UNKNOWN_MODEL;
        if (turn.model) {
            acc.model = turn.model;
        }
        let slice = acc.byModel.get(rowModel);
        if (!slice) {
            slice = {
                tokens: 0,
                breakdown: {
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheWrite5mTokens: 0,
                    cacheWrite1hTokens: 0,
                },
                speed: null,
            };
            acc.byModel.set(rowModel, slice);
        }
        slice.tokens += input + row.output;
        slice.breakdown.inputTokens += row.freshInput;
        slice.breakdown.outputTokens += row.output;
        slice.breakdown.cacheReadTokens += row.cacheRead;
        slice.breakdown.cacheWrite5mTokens += row.cacheWrite5m;
        slice.breakdown.cacheWrite1hTokens += row.cacheWrite1h;
    }
    if (!isSubAgent) {
        const ctx = readGrokContextBudgetFromDir(path.dirname(filePath), acc.model);
        if (ctx) {
            acc.contextTokens = ctx.used;
            acc.runtimeContextWindow = ctx.total;
            if (ctx.model) {
                acc.model = ctx.model;
            }
        }
    }
}
async function foldTranscript(filePath, acc, isSubAgent) {
    if (path.basename(filePath) === 'updates.jsonl') {
        await foldGrokUpdates(filePath, acc, isSubAgent);
        return;
    }
    const seenMessageIds = new Set();
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
    });
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
        if (!isSubAgent && isContextCompaction(entry))
            acc.contextTokens = null;
        const usage = entry?.message?.usage
            ?? (entry?.event?.type === 'step.end' ? entry.event.usage : null);
        if (usage && typeof usage === 'object') {
            const directInput = readUsageNumber(usage.input_tokens ?? usage.inputTokens ?? usage.inputOther);
            const cacheRead = readUsageNumber(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cacheReadTokens ?? usage.inputCacheRead);
            const cacheCreation = readUsageNumber(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? usage.cacheCreationTokens ?? usage.inputCacheCreation);
            const output = readUsageNumber(usage.output_tokens ?? usage.outputTokens ?? usage.output);
            // Same duplicate-row collapse as the history scanner (see DEDUPLICATION).
            // Kimi `step.end` rows carry no message id and are counted as-is.
            const messageId = typeof entry?.message?.id === 'string' ? entry.message.id : null;
            const isDuplicate = messageId !== null && seenMessageIds.has(messageId);
            if (messageId) {
                seenMessageIds.add(messageId);
            }
            if (!isDuplicate) {
                acc.inputTokens += directInput + cacheRead + cacheCreation;
                acc.outputTokens += output;
                acc.cacheReadTokens += cacheRead;
                acc.cacheCreationTokens += cacheCreation;
                const rowModel = typeof entry?.message?.model === 'string' && entry.message.model !== '<synthetic>'
                    ? entry.message.model
                    : typeof entry?.model === 'string' && entry.model
                        ? entry.model
                        : acc.model ?? UNKNOWN_MODEL;
                let slice = acc.byModel.get(rowModel);
                if (!slice) {
                    slice = {
                        tokens: 0,
                        breakdown: {
                            inputTokens: 0,
                            outputTokens: 0,
                            cacheReadTokens: 0,
                            cacheWrite5mTokens: 0,
                            cacheWrite1hTokens: 0,
                        },
                        speed: null,
                    };
                    acc.byModel.set(rowModel, slice);
                }
                const split = readCacheCreationSplit(usage);
                const hasSplit = split.cacheWrite5mTokens > 0 || split.cacheWrite1hTokens > 0;
                slice.tokens += directInput + cacheRead + cacheCreation + output;
                slice.breakdown.inputTokens += directInput;
                slice.breakdown.outputTokens += output;
                slice.breakdown.cacheReadTokens += cacheRead;
                // No TTL split (older schema / kimi): bill at the cheaper 5m rate.
                slice.breakdown.cacheWrite5mTokens += hasSplit ? split.cacheWrite5mTokens : cacheCreation;
                slice.breakdown.cacheWrite1hTokens += hasSplit ? split.cacheWrite1hTokens : 0;
                if (typeof usage.speed === 'string') {
                    slice.speed = usage.speed;
                }
            }
            // Context fullness is a snapshot of the LAST turn of THIS session, not a
            // sum — a repeated row simply restates it, so this stays outside the
            // duplicate guard, and sub-agent files never touch it.
            if (!isSubAgent) {
                const context = readClaudeContextBudget(entry);
                if (context)
                    acc.contextTokens = context.used;
                else if (entry?.event?.type === 'step.end')
                    acc.contextTokens = directInput + cacheRead + cacheCreation + output;
            }
        }
        if (isSubAgent) {
            continue;
        }
        // `<synthetic>` marks non-LLM placeholder rows in claude transcripts.
        const messageModel = entry?.message?.model;
        if (typeof messageModel === 'string' && messageModel && messageModel !== '<synthetic>') {
            acc.model = messageModel;
        }
        else if (entry?.type === 'llm.request' && typeof entry.model === 'string' && entry.model) {
            acc.model = entry.model;
        }
    }
}
export async function getSessionCostSnapshot(sessionId, options = {}) {
    if (!sessionId || typeof sessionId !== 'string') {
        return null;
    }
    const transcriptPath = await findSessionTranscript(sessionId, options.projectPath);
    if (!transcriptPath) {
        return null;
    }
    const acc = {
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contextTokens: null,
        byModel: new Map(),
    };
    await foldTranscript(transcriptPath, acc, false);
    // Sub-agents this session spawned live in a sibling folder named after the
    // transcript. Their burn belongs to this session, exactly as in the history
    // view — otherwise the same session reports two different totals.
    const subAgentDir = path.join(path.dirname(transcriptPath), path.basename(transcriptPath, '.jsonl'));
    try {
        if (fs.existsSync(subAgentDir)) {
            for (const { filePath } of await collectTranscripts(subAgentDir)) {
                await foldTranscript(filePath, acc, true);
            }
        }
    }
    catch {
        // A missing/unreadable sub-agent folder must not break the modal.
    }
    let costUsd = null;
    for (const [model, slice] of acc.byModel) {
        const estimate = estimateCostUsd(slice.breakdown, model || acc.model, { speed: slice.speed });
        if (estimate) {
            costUsd = (costUsd ?? 0) + estimate.totalUsd;
        }
    }
    return {
        model: acc.model,
        inputTokens: acc.inputTokens,
        outputTokens: acc.outputTokens,
        cacheReadTokens: acc.cacheReadTokens,
        cacheCreationTokens: acc.cacheCreationTokens,
        totalTokens: acc.inputTokens + acc.outputTokens,
        contextTokens: acc.contextTokens,
        contextWindow: acc.runtimeContextWindow ?? getContextWindow(acc.model),
        costUsd,
        transcriptPath,
    };
}
/**
 * Shape the composer chip expects. `used`/`total` are the context-window
 * fill; `inputTokens`/`outputTokens` are the full-session burn (what the
 * mini chip shows as "сколько потрачено").
 */
export function snapshotToComposerBudget(snapshot) {
    return {
        used: snapshot.contextTokens,
        total: snapshot.contextWindow,
        model: snapshot.model,
        inputTokens: snapshot.inputTokens,
        outputTokens: snapshot.outputTokens,
        cacheReadTokens: snapshot.cacheReadTokens,
        cacheCreationTokens: snapshot.cacheCreationTokens,
        cacheTokens: snapshot.cacheReadTokens + snapshot.cacheCreationTokens,
        breakdown: {
            input: snapshot.inputTokens,
            output: snapshot.outputTokens,
        },
    };
}
//# sourceMappingURL=session-usage.js.map
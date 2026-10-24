import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { appConfigDb, pushSubscriptionsDb, userDb } from '../../modules/database/index.js';
import { sendDesktopNotification } from '../../modules/notifications/services/desktop-notification-clients.service.js';
import { buildNotificationPayload, createNotificationEvent, sendWebPushPayload, } from '../../modules/notifications/services/notification-orchestrator.service.js';
import { ensurePushPolicyFile, readPushPolicy } from '../../modules/sticky-push/push-policy.js';
const execFileAsync = promisify(execFile);
const TOKEN_KEY = 'sticky_push_token';
const CONSIGLIERE_EVERY_MS = 10 * 60 * 1000;
function statePath() {
    return process.env.STICKY_PUSH_STATE
        || path.join(os.homedir(), '.cloudcli', 'sticky-push-state.json');
}
function tokenFilePath() {
    return path.join(os.homedir(), '.cloudcli', 'sticky-push-token');
}
let state = { consigliere: {}, bots: {} };
let stateLoaded = false;
let lastConsigliereSync = 0;
function emptyState() {
    return { consigliere: {}, bots: {} };
}
async function loadState() {
    if (stateLoaded)
        return state;
    try {
        const parsed = JSON.parse(await fs.readFile(statePath(), 'utf8'));
        state = {
            consigliere: parsed.consigliere && typeof parsed.consigliere === 'object' ? parsed.consigliere : {},
            bots: parsed.bots && typeof parsed.bots === 'object' ? parsed.bots : {},
        };
    }
    catch {
        state = emptyState();
    }
    stateLoaded = true;
    return state;
}
async function persistState() {
    try {
        await fs.mkdir(path.dirname(statePath()), { recursive: true });
        await fs.writeFile(statePath(), JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    }
    catch (error) {
        console.error('[sticky-push] state save failed:', error instanceof Error ? error.message : error);
    }
}
export function getStickyPushToken() {
    const fromEnv = String(process.env.STICKY_PUSH_TOKEN || '').trim();
    if (fromEnv)
        return fromEnv;
    let token = appConfigDb.get(TOKEN_KEY);
    if (!token) {
        token = crypto.randomBytes(24).toString('hex');
        appConfigDb.set(TOKEN_KEY, token);
        void fs.mkdir(path.dirname(tokenFilePath()), { recursive: true })
            .then(() => fs.writeFile(tokenFilePath(), `${token}\n`, { encoding: 'utf8', mode: 0o600 }))
            .catch(() => undefined);
    }
    return token;
}
export function stickyPushTokenMatches(candidate) {
    if (!candidate)
        return false;
    const expected = getStickyPushToken();
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function signDone(row) {
    return crypto.createHmac('sha256', getStickyPushToken()).update(`done:${row}`).digest('hex');
}
export function verifyDoneSig(row, sig) {
    if (!sig)
        return false;
    const expected = signDone(row);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function ownerUserId() {
    return stickyRecipientIds()[0] ?? null;
}
/** Phone push lives on whoever enabled it — not necessarily the first admin. */
export function stickyRecipientIds() {
    const users = userDb.listUsers();
    const ids = new Set();
    for (const user of users) {
        if (Number(user.is_active) !== 1)
            continue;
        const id = Number(user.id);
        if (!Number.isInteger(id) || id <= 0)
            continue;
        if (user.role === 'admin')
            ids.add(id);
        if (pushSubscriptionsDb.getSubscriptions(id).length > 0)
            ids.add(id);
    }
    if (ids.size)
        return [...ids];
    const fallback = userDb.getFirstUser();
    const id = fallback ? Number(fallback.id) : NaN;
    return Number.isInteger(id) && id > 0 ? [id] : [];
}
function recipientIdsWithPush() {
    return stickyRecipientIds().filter((id) => pushSubscriptionsDb.getSubscriptions(id).length > 0);
}
/** Old state has no deliveredTo — treat as "never reached the phone". */
function needsLoudPush(already, pushIds) {
    if (!pushIds.length)
        return false;
    if (!already)
        return true;
    const delivered = new Set((already.deliveredTo || []).map(Number));
    return pushIds.some((id) => !delivered.has(id));
}
async function forEachRecipient(fn) {
    const ids = stickyRecipientIds();
    if (!ids.length)
        return false;
    for (const id of ids) {
        await fn(id).catch(() => undefined);
    }
    return true;
}
function stripHtml(text) {
    return text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
export function isDeadBotKey(key) {
    return key.startsWith('svc:') && (key.endsWith(':failed') || key.endsWith(':flapping'));
}
export function botUnitFromKey(key) {
    const inner = key.slice(4);
    const cut = inner.lastIndexOf(':');
    return cut > 0 ? inner.slice(0, cut) : inner;
}
async function sendEvent(userId, event) {
    const payload = buildNotificationPayload(event);
    await sendWebPushPayload(userId, payload);
    try {
        sendDesktopNotification(userId, payload);
    }
    catch {
        // Desktop app may be closed — phone push still goes.
    }
}
export async function closeTag(userId, tag) {
    if (!tag)
        return;
    await sendWebPushPayload(userId, {
        close: true,
        data: { tag, code: 'notification.close' },
    });
}
async function closeTagEverywhere(tag) {
    await forEachRecipient((userId) => closeTag(userId, tag));
}
function consigliereBackend() {
    return process.env.CONSIGLIERE_BACKEND
        || path.join(os.homedir(), 'Antigravity Project', 'consigliere', 'backend');
}
function consiglierePython() {
    return process.env.CONSIGLIERE_PYTHON
        || path.join(consigliereBackend(), '.venv', 'bin', 'python');
}
async function listEventsFromSheet() {
    const backend = consigliereBackend();
    const { stdout } = await execFileAsync(consiglierePython(), [path.join(backend, 'list_sticky_events.py')], { cwd: backend, timeout: 25_000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(String(stdout || '[]'));
    if (!Array.isArray(parsed))
        return [];
    return parsed.filter((item) => {
        if (!item || typeof item !== 'object')
            return false;
        const row = Number(item.row);
        const kind = item.kind;
        return Number.isInteger(row) && row >= 2 && (kind === 'due' || kind === 'overdue');
    });
}
async function markEventDoneOnSheet(row) {
    const backend = consigliereBackend();
    await execFileAsync(consiglierePython(), [path.join(backend, 'mark_event_done.py'), String(row)], { cwd: backend, timeout: 25_000 });
}
async function markSubPaidOnSheet(row) {
    const backend = consigliereBackend();
    await execFileAsync(consiglierePython(), [path.join(backend, 'mark_sub_paid.py'), String(row)], { cwd: backend, timeout: 25_000 });
}
function asPlannerKind(value) {
    return value === 'overdue' || value === 'due' ? value : 'upcoming';
}
function asInt(value) {
    if (value == null || value === '')
        return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}
function asText(value) {
    return value == null ? '' : String(value);
}
export function normalizePlanner(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const events = [];
    const cards = [];
    const subs = [];
    if (Array.isArray(source.events)) {
        for (const item of source.events) {
            if (!item || typeof item !== 'object')
                continue;
            const row = asInt(item.row);
            if (row == null || row < 2)
                continue;
            events.push({
                row,
                title: asText(item.title) || 'Событие',
                date: asText(item.date),
                time: asText(item.time),
                kind: asPlannerKind(item.kind),
                when: asText(item.when),
            });
        }
    }
    if (Array.isArray(source.cards)) {
        for (const item of source.cards) {
            if (!item || typeof item !== 'object')
                continue;
            const row = asInt(item.row);
            if (row == null || row < 2)
                continue;
            const daysLeft = asInt(item.daysLeft);
            cards.push({
                row,
                name: asText(item.name) || 'Карта',
                amount: asText(item.amount),
                dueDate: asText(item.dueDate),
                daysLeft,
                nextPayDate: asText(item.nextPayDate),
                nextPayAmount: asText(item.nextPayAmount),
                kind: asPlannerKind(item.kind),
            });
        }
    }
    if (Array.isArray(source.subs)) {
        for (const item of source.subs) {
            if (!item || typeof item !== 'object')
                continue;
            const row = asInt(item.row);
            if (row == null || row < 2)
                continue;
            subs.push({
                row,
                name: asText(item.name) || 'Подписка',
                day: asText(item.day),
                amount: asText(item.amount),
                daysLeft: asInt(item.daysLeft),
                kind: asPlannerKind(item.kind),
            });
        }
    }
    return { events, cards, subs };
}
export async function loadPlanner() {
    const backend = consigliereBackend();
    const { stdout } = await execFileAsync(consiglierePython(), [path.join(backend, 'list_planner.py')], { cwd: backend, timeout: 25_000, maxBuffer: 1024 * 1024 });
    let parsed = {};
    try {
        parsed = JSON.parse(String(stdout || '{}'));
    }
    catch {
        throw new Error('Канцелярия вернула не JSON');
    }
    return normalizePlanner(parsed);
}
export function filterEventsByPolicy(events, policy = readPushPolicy()) {
    if (!policy.consigliere.enabled)
        return [];
    const kinds = new Set(policy.consigliere.kinds);
    return events.filter((event) => kinds.has(event.kind));
}
function formatWhen(event) {
    if (event.time) {
        const date = event.date ? event.date.slice(8) + '.' + event.date.slice(5, 7) : '';
        return date ? `${date} в ${event.time}` : event.time;
    }
    return event.date || '';
}
export async function syncConsigliereEvents(events, now = Date.now(), policy = readPushPolicy()) {
    await loadState();
    ensurePushPolicyFile();
    const sent = [];
    const closed = [];
    if (!(await forEachRecipient(async () => undefined)))
        return { sent, closed };
    const live = filterEventsByPolicy(events, policy);
    const liveRows = new Set(live.map((event) => String(event.row)));
    for (const [row, entry] of Object.entries(state.consigliere)) {
        if (liveRows.has(row))
            continue;
        await closeTagEverywhere(entry.tag).catch(() => undefined);
        delete state.consigliere[row];
        closed.push(row);
    }
    const pushIds = recipientIdsWithPush();
    for (const event of live) {
        const row = String(event.row);
        const tag = `consigliere:event:${event.row}`;
        const already = state.consigliere[row];
        const alreadyDelivered = Boolean(already) && !needsLoudPush(already, pushIds);
        const silent = alreadyDelivered && policy.consigliere.restore_silent;
        if (alreadyDelivered && !policy.consigliere.restore_silent)
            continue;
        if (!alreadyDelivered) {
            console.info(`[sticky-push] loud event ${row} → push users ${pushIds.join(',') || 'none'}`);
        }
        await forEachRecipient((userId) => sendEvent(userId, createNotificationEvent({
            provider: 'system',
            kind: 'action_required',
            code: 'consigliere.task',
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `consigliere:task:${event.row}:${silent ? 'silent' : 'loud'}:${Math.floor(now / 60_000)}`,
            meta: {
                row: event.row,
                title: event.title,
                kind: event.kind,
                when: formatWhen(event),
                tag,
                silent,
                sig: signDone(event.row),
            },
        })));
        state.consigliere[row] = {
            loudAt: already?.loudAt ?? now,
            tag,
            deliveredTo: pushIds,
        };
        sent.push(silent ? `silent:${row}` : `loud:${row}`);
    }
    await persistState();
    return { sent, closed };
}
export async function maybeSyncConsigliere(now = Date.now()) {
    if (now - lastConsigliereSync < CONSIGLIERE_EVERY_MS)
        return;
    lastConsigliereSync = now;
    const policy = readPushPolicy();
    if (!policy.consigliere.enabled) {
        await loadState();
        for (const entry of Object.values(state.consigliere)) {
            await closeTagEverywhere(entry.tag).catch(() => undefined);
        }
        state.consigliere = {};
        await persistState();
        return;
    }
    try {
        const events = await listEventsFromSheet();
        await syncConsigliereEvents(events, now, policy);
    }
    catch (error) {
        console.error('[sticky-push] consigliere sync failed:', error instanceof Error ? error.message : error);
    }
}
export async function completeConsigliereTask(row) {
    if (!Number.isInteger(row) || row < 2) {
        throw new Error('Некорректный номер строки события');
    }
    await markEventDoneOnSheet(row);
    await loadState();
    const entry = state.consigliere[String(row)];
    const tag = entry?.tag || `consigliere:event:${row}`;
    await closeTagEverywhere(tag).catch(() => undefined);
    delete state.consigliere[String(row)];
    await persistState();
}
export async function completeSubPaid(row) {
    if (!Number.isInteger(row) || row < 2) {
        throw new Error('Некорректный номер строки подписки');
    }
    await markSubPaidOnSheet(row);
}
export async function completePlannerItem(kind, row) {
    if (kind === 'event') {
        await completeConsigliereTask(row);
        return;
    }
    if (kind === 'sub') {
        await completeSubPaid(row);
        return;
    }
    throw new Error('Неизвестный тип задачи');
}
function isMutedUnit(unit, name, mute) {
    const muted = new Set(mute.map((item) => item.trim()).filter(Boolean));
    return muted.has(unit) || muted.has(name) || muted.has(unit.replace(/\.service$/, ''));
}
export async function syncDeadBots(problems, now = Date.now(), policy = readPushPolicy()) {
    await loadState();
    ensurePushPolicyFile();
    const sent = [];
    const closed = [];
    if (!(await forEachRecipient(async () => undefined)))
        return { sent, closed };
    const liveKeys = new Set(problems.filter((problem) => isDeadBotKey(problem.key)).map((problem) => problem.key));
    for (const [key, entry] of Object.entries(state.bots)) {
        if (liveKeys.has(key))
            continue;
        await closeTagEverywhere(entry.tag).catch(() => undefined);
        delete state.bots[key];
        closed.push(key);
    }
    if (!policy.bots.enabled) {
        await persistState();
        return { sent, closed };
    }
    const graceMs = policy.bots.grace_min * 60 * 1000;
    for (const problem of problems) {
        if (!isDeadBotKey(problem.key))
            continue;
        const unit = botUnitFromKey(problem.key);
        const name = stripHtml(problem.text);
        if (isMutedUnit(unit, name, policy.bots.mute))
            continue;
        const since = Number(problem.since) || now;
        if (now - since < graceMs)
            continue;
        if (state.bots[problem.key])
            continue;
        const tag = `bot:${unit}`;
        await forEachRecipient((userId) => sendEvent(userId, createNotificationEvent({
            provider: 'system',
            kind: 'error',
            code: 'bot.dead',
            severity: 'error',
            dedupeKey: `bot:dead:${unit}`,
            meta: { unit, name, tag },
        })));
        state.bots[problem.key] = { pushedAt: now, tag, unit };
        sent.push(problem.key);
    }
    await persistState();
    return { sent, closed };
}
export async function resetStickyPushStateForTests(seed) {
    state = {
        consigliere: seed?.consigliere && typeof seed.consigliere === 'object' ? { ...seed.consigliere } : {},
        bots: seed?.bots && typeof seed.bots === 'object' ? { ...seed.bots } : {},
    };
    stateLoaded = true;
    lastConsigliereSync = 0;
}
//# sourceMappingURL=sticky-push.service.js.map
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { appConfigDb, pushSubscriptionsDb, userDb } from '@/modules/database/index.js';
import { sendDesktopNotification } from '@/modules/notifications/services/desktop-notification-clients.service.js';
import {
  buildNotificationPayload,
  createNotificationEvent,
  sendWebPushPayload,
} from '@/modules/notifications/services/notification-orchestrator.service.js';
import { ensurePushPolicyFile, readPushPolicy, type ConsigliereKind, type PushPolicy } from '@/modules/sticky-push/push-policy.js';

const execFileAsync = promisify(execFile);

const TOKEN_KEY = 'sticky_push_token';
const CONSIGLIERE_EVERY_MS = 10 * 60 * 1000;

function statePath(): string {
  return process.env.STICKY_PUSH_STATE
    || path.join(os.homedir(), '.cloudcli', 'sticky-push-state.json');
}

function tokenFilePath(): string {
  return path.join(os.homedir(), '.cloudcli', 'sticky-push-token');
}

export type StickyEvent = {
  row: number;
  title: string;
  date: string;
  time: string;
  kind: ConsigliereKind;
};

export type PlannerItemKind = 'overdue' | 'due' | 'upcoming';

export type PlannerEvent = {
  row: number;
  title: string;
  date: string;
  time: string;
  kind: PlannerItemKind;
  when: string;
};

export type PlannerCard = {
  row: number;
  name: string;
  amount: string;
  dueDate: string;
  daysLeft: number | null;
  nextPayDate: string;
  nextPayAmount: string;
  kind: PlannerItemKind;
};

export type PlannerSub = {
  row: number;
  name: string;
  day: string;
  amount: string;
  daysLeft: number | null;
  kind: PlannerItemKind;
};

export type PlannerPayload = {
  events: PlannerEvent[];
  cards: PlannerCard[];
  subs: PlannerSub[];
};

export type PlannerDoneKind = 'event' | 'sub';

type ProblemLike = { key: string; text: string; since?: number };

type ConsigliereEntry = { loudAt: number; tag: string; deliveredTo?: number[] };
type BotEntry = { pushedAt: number; tag: string; unit: string };

type StickyState = {
  consigliere: Record<string, ConsigliereEntry>;
  bots: Record<string, BotEntry>;
};

let state: StickyState = { consigliere: {}, bots: {} };
let stateLoaded = false;
let lastConsigliereSync = 0;

function emptyState(): StickyState {
  return { consigliere: {}, bots: {} };
}

async function loadState(): Promise<StickyState> {
  if (stateLoaded) return state;
  try {
    const parsed = JSON.parse(await fs.readFile(statePath(), 'utf8')) as Partial<StickyState>;
    state = {
      consigliere: parsed.consigliere && typeof parsed.consigliere === 'object' ? parsed.consigliere : {},
      bots: parsed.bots && typeof parsed.bots === 'object' ? parsed.bots : {},
    };
  } catch {
    state = emptyState();
  }
  stateLoaded = true;
  return state;
}

async function persistState(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(statePath()), { recursive: true });
    await fs.writeFile(statePath(), JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.error('[sticky-push] state save failed:', error instanceof Error ? error.message : error);
  }
}

export function getStickyPushToken(): string {
  const fromEnv = String(process.env.STICKY_PUSH_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
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

export function stickyPushTokenMatches(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const expected = getStickyPushToken();
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signDone(row: number): string {
  return crypto.createHmac('sha256', getStickyPushToken()).update(`done:${row}`).digest('hex');
}

export function verifyDoneSig(row: number, sig: string | undefined): boolean {
  if (!sig) return false;
  const expected = signDone(row);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function ownerUserId(): number | null {
  return stickyRecipientIds()[0] ?? null;
}

/** Phone push lives on whoever enabled it — not necessarily the first admin. */
export function stickyRecipientIds(): number[] {
  const users = userDb.listUsers();
  const ids = new Set<number>();
  for (const user of users) {
    if (Number(user.is_active) !== 1) continue;
    const id = Number(user.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (user.role === 'admin') ids.add(id);
    if (pushSubscriptionsDb.getSubscriptions(id).length > 0) ids.add(id);
  }
  if (ids.size) return [...ids];
  const fallback = userDb.getFirstUser();
  const id = fallback ? Number(fallback.id) : NaN;
  return Number.isInteger(id) && id > 0 ? [id] : [];
}

function recipientIdsWithPush(): number[] {
  return stickyRecipientIds().filter((id) => pushSubscriptionsDb.getSubscriptions(id).length > 0);
}

/** Old state has no deliveredTo — treat as "never reached the phone". */
function needsLoudPush(already: ConsigliereEntry | undefined, pushIds: number[]): boolean {
  if (!pushIds.length) return false;
  if (!already) return true;
  const delivered = new Set((already.deliveredTo || []).map(Number));
  return pushIds.some((id) => !delivered.has(id));
}

async function forEachRecipient(fn: (userId: number) => Promise<void>): Promise<boolean> {
  const ids = stickyRecipientIds();
  if (!ids.length) return false;
  for (const id of ids) {
    await fn(id).catch(() => undefined);
  }
  return true;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function isDeadBotKey(key: string): boolean {
  return key.startsWith('svc:') && (key.endsWith(':failed') || key.endsWith(':flapping'));
}

export function botUnitFromKey(key: string): string {
  const inner = key.slice(4);
  const cut = inner.lastIndexOf(':');
  return cut > 0 ? inner.slice(0, cut) : inner;
}

async function sendEvent(userId: number, event: ReturnType<typeof createNotificationEvent>): Promise<void> {
  const payload = buildNotificationPayload(event);
  await sendWebPushPayload(userId, payload);
  try {
    sendDesktopNotification(userId, payload);
  } catch {
    // Desktop app may be closed — phone push still goes.
  }
}

export async function closeTag(userId: number, tag: string): Promise<void> {
  if (!tag) return;
  await sendWebPushPayload(userId, {
    close: true,
    data: { tag, code: 'notification.close' },
  });
}

async function closeTagEverywhere(tag: string): Promise<void> {
  await forEachRecipient((userId) => closeTag(userId, tag));
}

function consigliereBackend(): string {
  return process.env.CONSIGLIERE_BACKEND
    || path.join(os.homedir(), 'Antigravity Project', 'consigliere', 'backend');
}

function consiglierePython(): string {
  return process.env.CONSIGLIERE_PYTHON
    || path.join(consigliereBackend(), '.venv', 'bin', 'python');
}

async function listEventsFromSheet(): Promise<StickyEvent[]> {
  const backend = consigliereBackend();
  const { stdout } = await execFileAsync(
    consiglierePython(),
    [path.join(backend, 'list_sticky_events.py')],
    { cwd: backend, timeout: 25_000, maxBuffer: 1024 * 1024 },
  );
  const parsed = JSON.parse(String(stdout || '[]')) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is StickyEvent => {
    if (!item || typeof item !== 'object') return false;
    const row = Number((item as StickyEvent).row);
    const kind = (item as StickyEvent).kind;
    return Number.isInteger(row) && row >= 2 && (kind === 'due' || kind === 'overdue');
  });
}

async function markEventDoneOnSheet(row: number): Promise<void> {
  const backend = consigliereBackend();
  await execFileAsync(
    consiglierePython(),
    [path.join(backend, 'mark_event_done.py'), String(row)],
    { cwd: backend, timeout: 25_000 },
  );
}

async function markSubPaidOnSheet(row: number): Promise<void> {
  const backend = consigliereBackend();
  await execFileAsync(
    consiglierePython(),
    [path.join(backend, 'mark_sub_paid.py'), String(row)],
    { cwd: backend, timeout: 25_000 },
  );
}

function asPlannerKind(value: unknown): PlannerItemKind {
  return value === 'overdue' || value === 'due' ? value : 'upcoming';
}

function asInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function asText(value: unknown): string {
  return value == null ? '' : String(value);
}

export function normalizePlanner(raw: unknown): PlannerPayload {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const events: PlannerEvent[] = [];
  const cards: PlannerCard[] = [];
  const subs: PlannerSub[] = [];

  if (Array.isArray(source.events)) {
    for (const item of source.events) {
      if (!item || typeof item !== 'object') continue;
      const row = asInt((item as PlannerEvent).row);
      if (row == null || row < 2) continue;
      events.push({
        row,
        title: asText((item as PlannerEvent).title) || 'Событие',
        date: asText((item as PlannerEvent).date),
        time: asText((item as PlannerEvent).time),
        kind: asPlannerKind((item as PlannerEvent).kind),
        when: asText((item as PlannerEvent).when),
      });
    }
  }

  if (Array.isArray(source.cards)) {
    for (const item of source.cards) {
      if (!item || typeof item !== 'object') continue;
      const row = asInt((item as PlannerCard).row);
      if (row == null || row < 2) continue;
      const daysLeft = asInt((item as PlannerCard).daysLeft);
      cards.push({
        row,
        name: asText((item as PlannerCard).name) || 'Карта',
        amount: asText((item as PlannerCard).amount),
        dueDate: asText((item as PlannerCard).dueDate),
        daysLeft,
        nextPayDate: asText((item as PlannerCard).nextPayDate),
        nextPayAmount: asText((item as PlannerCard).nextPayAmount),
        kind: asPlannerKind((item as PlannerCard).kind),
      });
    }
  }

  if (Array.isArray(source.subs)) {
    for (const item of source.subs) {
      if (!item || typeof item !== 'object') continue;
      const row = asInt((item as PlannerSub).row);
      if (row == null || row < 2) continue;
      subs.push({
        row,
        name: asText((item as PlannerSub).name) || 'Подписка',
        day: asText((item as PlannerSub).day),
        amount: asText((item as PlannerSub).amount),
        daysLeft: asInt((item as PlannerSub).daysLeft),
        kind: asPlannerKind((item as PlannerSub).kind),
      });
    }
  }

  return { events, cards, subs };
}

export async function loadPlanner(): Promise<PlannerPayload> {
  const backend = consigliereBackend();
  const { stdout } = await execFileAsync(
    consiglierePython(),
    [path.join(backend, 'list_planner.py')],
    { cwd: backend, timeout: 25_000, maxBuffer: 1024 * 1024 },
  );
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(String(stdout || '{}'));
  } catch {
    throw new Error('Канцелярия вернула не JSON');
  }
  return normalizePlanner(parsed);
}

export function filterEventsByPolicy(events: StickyEvent[], policy: PushPolicy = readPushPolicy()): StickyEvent[] {
  if (!policy.consigliere.enabled) return [];
  const kinds = new Set(policy.consigliere.kinds);
  return events.filter((event) => kinds.has(event.kind));
}

function formatWhen(event: StickyEvent): string {
  if (event.time) {
    const date = event.date ? event.date.slice(8) + '.' + event.date.slice(5, 7) : '';
    return date ? `${date} в ${event.time}` : event.time;
  }
  return event.date || '';
}

export async function syncConsigliereEvents(
  events: StickyEvent[],
  now: number = Date.now(),
  policy: PushPolicy = readPushPolicy(),
): Promise<{ sent: string[]; closed: string[] }> {
  await loadState();
  ensurePushPolicyFile();
  const sent: string[] = [];
  const closed: string[] = [];
  if (!(await forEachRecipient(async () => undefined))) return { sent, closed };

  const live = filterEventsByPolicy(events, policy);
  const liveRows = new Set(live.map((event) => String(event.row)));

  for (const [row, entry] of Object.entries(state.consigliere)) {
    if (liveRows.has(row)) continue;
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
    if (alreadyDelivered && !policy.consigliere.restore_silent) continue;
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

export async function maybeSyncConsigliere(now: number = Date.now()): Promise<void> {
  if (now - lastConsigliereSync < CONSIGLIERE_EVERY_MS) return;
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
  } catch (error) {
    console.error('[sticky-push] consigliere sync failed:', error instanceof Error ? error.message : error);
  }
}

export async function completeConsigliereTask(row: number): Promise<void> {
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

export async function completeSubPaid(row: number): Promise<void> {
  if (!Number.isInteger(row) || row < 2) {
    throw new Error('Некорректный номер строки подписки');
  }
  await markSubPaidOnSheet(row);
}

export async function completePlannerItem(kind: PlannerDoneKind, row: number): Promise<void> {
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

function isMutedUnit(unit: string, name: string, mute: string[]): boolean {
  const muted = new Set(mute.map((item) => item.trim()).filter(Boolean));
  return muted.has(unit) || muted.has(name) || muted.has(unit.replace(/\.service$/, ''));
}

export async function syncDeadBots(
  problems: ProblemLike[],
  now: number = Date.now(),
  policy: PushPolicy = readPushPolicy(),
): Promise<{ sent: string[]; closed: string[] }> {
  await loadState();
  ensurePushPolicyFile();
  const sent: string[] = [];
  const closed: string[] = [];
  if (!(await forEachRecipient(async () => undefined))) return { sent, closed };

  const liveKeys = new Set(
    problems.filter((problem) => isDeadBotKey(problem.key)).map((problem) => problem.key),
  );

  for (const [key, entry] of Object.entries(state.bots)) {
    if (liveKeys.has(key)) continue;
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
    if (!isDeadBotKey(problem.key)) continue;
    const unit = botUnitFromKey(problem.key);
    const name = stripHtml(problem.text);
    if (isMutedUnit(unit, name, policy.bots.mute)) continue;
    const since = Number(problem.since) || now;
    if (now - since < graceMs) continue;
    if (state.bots[problem.key]) continue;
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

export async function resetStickyPushStateForTests(seed?: Partial<StickyState>): Promise<void> {
  state = {
    consigliere: seed?.consigliere && typeof seed.consigliere === 'object' ? { ...seed.consigliere } : {},
    bots: seed?.bots && typeof seed.bots === 'object' ? { ...seed.bots } : {},
  };
  stateLoaded = true;
  lastConsigliereSync = 0;
}

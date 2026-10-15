import type { AttentionCounts, AttentionItem, AttentionSeenTarget } from '../types';

/**
 * Pure model of the "Ждут тебя" hub: what counts toward N, how sessions are
 * grouped, how a status is labelled. No React, no fetch — unit-tested.
 */

/**
 * A question the agent only asked in its reply text (no open request behind
 * it). Nothing blocks on it, so like done/failed it leaves the hub once seen.
 */
export function isSoftWaiting(entry: AttentionItem): boolean {
  return entry.state === 'waiting' && (entry.reason === 'manual_ask' || entry.reason === 'text_question');
}

/** done/failed or a soft question: opening the chat or «Всё просмотрено» clears it. */
export function isSeenable(entry: AttentionItem): boolean {
  return entry.state === 'done' || entry.state === 'failed' || isSoftWaiting(entry);
}

/** N for the tab title / app badge = waiting (soft: unread) + unread failed + unread done. */
export function countAttention(items: readonly AttentionItem[]): { total: number; counts: AttentionCounts } {
  const counts: AttentionCounts = { waiting: 0, failed: 0, unreadDone: 0, working: 0 };
  for (const entry of items) {
    if (entry.state === 'waiting') {
      if (!isSoftWaiting(entry) || entry.unread) counts.waiting += 1;
    }
    else if (entry.state === 'working') counts.working += 1;
    else if (entry.state === 'failed' && entry.unread) counts.failed += 1;
    else if (entry.state === 'done' && entry.unread) counts.unreadDone += 1;
  }
  return { total: counts.waiting + counts.failed + counts.unreadDone, counts };
}

export type AttentionGroupKey = 'waiting' | 'failed' | 'done' | 'working';

export type AttentionGroup = {
  key: AttentionGroupKey;
  title: string;
  items: AttentionItem[];
};

const GROUP_TITLES: Record<AttentionGroupKey, string> = {
  waiting: 'Ждут ответа',
  failed: 'Упали',
  done: 'Готово',
  working: 'Работают',
};

const GROUP_ORDER: AttentionGroupKey[] = ['waiting', 'failed', 'done', 'working'];

function timeOf(entry: AttentionItem): number {
  const parsed = Date.parse(entry.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Which hub group a session belongs to, or null when it has left the hub
 * (done/failed/soft question the user has already looked at — "всё просмотрено" clears them).
 */
export function attentionGroupOf(entry: AttentionItem): AttentionGroupKey | null {
  if (entry.state === 'working') return entry.state;
  if (entry.state === 'waiting') return isSoftWaiting(entry) && !entry.unread ? null : entry.state;
  if ((entry.state === 'failed' || entry.state === 'done') && entry.unread) return entry.state;
  return null;
}

/**
 * Hub groups in display order, empty groups dropped. Waiting sessions list
 * the longest wait first (it has blocked the longest); the rest newest first.
 */
export function groupAttention(items: readonly AttentionItem[]): AttentionGroup[] {
  const buckets = new Map<AttentionGroupKey, AttentionItem[]>();
  for (const entry of items) {
    const key = attentionGroupOf(entry);
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }

  return GROUP_ORDER.flatMap((key) => {
    const bucket = buckets.get(key);
    if (!bucket || bucket.length === 0) return [];
    const sorted = [...bucket].sort((a, b) => (key === 'waiting' ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a)));
    return [{ key, title: GROUP_TITLES[key], items: sorted }];
  });
}

/** Colour family of a status; the view maps it onto theme tokens. */
export type AttentionTone = 'waiting' | 'failed' | 'done' | 'working';

export type AttentionDescription = {
  tone: AttentionTone;
  /** Short status caption: visible in the hub, aria-label/title on the sidebar dot. */
  statusLabel: string;
  /** "ждёт 13 мин" for waiting, "5 мин назад" otherwise. */
  ageLabel: string;
  /** The question / error / last ask on one line, clipped. */
  summary: string;
};

const WAITING_LABELS: Partial<Record<NonNullable<AttentionItem['reason']>, string>> = {
  ask: 'Ждёт ответа: вопрос',
  plan: 'Ждёт ответа: план',
  permission: 'Ждёт ответа: разрешение',
  manual_ask: 'Ждёт ответа: от тебя действие',
};

const SUMMARY_MAX = 140;

function statusLabelOf(entry: AttentionItem): string {
  switch (entry.state) {
    case 'waiting':
      return (entry.reason && WAITING_LABELS[entry.reason]) || 'Ждёт ответа';
    case 'failed':
      return entry.reason === 'interrupted' ? 'Упало: прервано' : 'Упало';
    case 'done':
      return 'Готово';
    default:
      return 'Работает';
  }
}

function formatSpan(fromMs: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - fromMs) / 60_000);
  if (minutes < 1) return '<1 мин';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} дн`;
}

function oneLine(text: string | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= SUMMARY_MAX) return flat;
  return `${flat.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
}

function summaryOf(entry: AttentionItem): string {
  const detail = entry.detail;
  if (!detail) return '';
  if (entry.state === 'waiting') return oneLine(detail.question || detail.excerpt);
  if (entry.state === 'failed') return oneLine(detail.error || detail.excerpt);
  if (entry.state === 'done') return oneLine(detail.excerpt);
  return '';
}

/** Everything a hub row or a sidebar dot needs to show one session's status. */
export function describeAttention(entry: AttentionItem, nowMs: number = Date.now()): AttentionDescription {
  const span = formatSpan(timeOf(entry) || nowMs, nowMs);
  return {
    tone: entry.state,
    statusLabel: statusLabelOf(entry),
    ageLabel: entry.state === 'waiting' ? `ждёт ${span}` : entry.state === 'working' ? `работает ${span}` : `${span} назад`,
    summary: summaryOf(entry),
  };
}

/**
 * Optimistic local copy of `POST /api/attention/seen`: marks done/failed and
 * soft questions as read. Open requests are untouched — only an answer closes them.
 */
export function applySeen(items: readonly AttentionItem[], target: AttentionSeenTarget): AttentionItem[] {
  const ids = 'all' in target ? null : new Set(target.sessionIds);
  return items.map((entry) => {
    if (!isSeenable(entry) || !entry.unread) return entry;
    if (ids && !ids.has(entry.sessionId)) return entry;
    return { ...entry, unread: false };
  });
}

export const PLANNER_CHANGED_EVENT = 'neo3:planner-changed';
export const ATTENTION_WINDOW_DAYS = 3;

export type PlannerKind = 'overdue' | 'due' | 'upcoming';

export type PlannerEvent = {
  row: number;
  title: string;
  date: string;
  time: string;
  kind: PlannerKind;
  when: string;
};

export type PlannerSub = {
  row: number;
  name: string;
  day: string;
  amount: string;
  daysLeft: number | null;
  kind: PlannerKind;
};

export type PlannerPayload = {
  events?: PlannerEvent[];
  cards?: unknown[];
  subs?: PlannerSub[];
};

export type AttentionKind = 'event' | 'sub';

export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  row: number;
  title: string;
  detail: string;
  label: string;
  urgency: PlannerKind;
};

export function moscowToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function daysFromMoscowToday(isoDate: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const start = Date.parse(`${isoDate}T00:00:00+03:00`);
  const origin = Date.parse(`${today}T00:00:00+03:00`);
  if (!Number.isFinite(start) || !Number.isFinite(origin)) return null;
  return Math.round((start - origin) / 86_400_000);
}

export function inAttentionWindow(kind: PlannerKind | undefined, daysLeft: number | null): boolean {
  if (kind === 'overdue' || kind === 'due') return true;
  return daysLeft != null && daysLeft >= 0 && daysLeft <= ATTENTION_WINDOW_DAYS;
}

function kindWord(kind: PlannerKind, daysLeft: number | null): string {
  if (kind === 'overdue') return 'просрочено';
  if (kind === 'due' || daysLeft === 0) return 'сегодня';
  if (daysLeft === 1) return 'завтра';
  if (daysLeft != null && daysLeft > 1) return `через ${daysLeft} дн`;
  return 'скоро';
}

export function pickAttentionItems(
  planner: PlannerPayload | null | undefined,
  today: string = moscowToday(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (!planner) return items;

  for (const event of planner.events ?? []) {
    const daysLeft = daysFromMoscowToday(event.date, today);
    if (!inAttentionWindow(event.kind, daysLeft)) continue;
    const title = String(event.title || 'Событие');
    const urgency = event.kind === 'overdue' || event.kind === 'due' ? event.kind : 'upcoming';
    const word = kindWord(urgency, daysLeft);
    const detail = event.when || event.date || word;
    items.push({
      key: `event:${event.row}`,
      kind: 'event',
      row: event.row,
      title,
      detail,
      label: `Событие «${title}» · ${word}`,
      urgency,
    });
  }

  for (const sub of planner.subs ?? []) {
    if (!inAttentionWindow(sub.kind, sub.daysLeft)) continue;
    const title = String(sub.name || 'Подписка');
    const urgency = sub.kind === 'overdue' || sub.kind === 'due' ? sub.kind : 'upcoming';
    const word = kindWord(urgency, sub.daysLeft);
    items.push({
      key: `sub:${sub.row}`,
      kind: 'sub',
      row: sub.row,
      title,
      detail: word,
      label: `Подписка «${title}» · ${word}`,
      urgency,
    });
  }

  return items;
}

export function notifyPlannerChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PLANNER_CHANGED_EVENT));
}

import type { AttentionItem } from '../attention/types';
import { isSeenable, isSoftWaiting } from '../attention/utils/attentionModel';

/**
 * Чистая модель «Панели диалогов»: полоса над полем ввода и списки боковой
 * панели по статусам «Ждут тебя» всех проектов и всех движков. Без React и
 * без запросов — данные приходят из `useAttention()`.
 */

export type SessionHubCounts = { working: number; waiting: number; done: number; failed: number };

export type SessionHubBarModel = {
  counts: SessionHubCounts;
  /** «работают 2 · ждут 1 · готово 3» (+ «· упали N», если есть). */
  label: string;
  /** Скрыть полосу, когда ничего не идёт и нечего смотреть. */
  visible: boolean;
};

export type SessionHubGroupKey = 'waiting' | 'working' | 'failed' | 'done';

export type SessionHubGroup = { key: SessionHubGroupKey; title: string; items: AttentionItem[] };

const GROUPS: Array<{ key: SessionHubGroupKey; title: string }> = [
  { key: 'waiting', title: 'Ждут' },
  { key: 'working', title: 'Работают' },
  { key: 'failed', title: 'Упали' },
  { key: 'done', title: 'Готово' },
];

/** Сколько готовых показывать в панели: прочитанные старые не нужны. */
const DONE_LIMIT = 30;

function timeOf(entry: AttentionItem): number {
  const parsed = Date.parse(entry.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Ждёт по-настоящему: открытый запрос или ещё не прочитанный вопрос текстом. */
function countsAsWaiting(entry: AttentionItem): boolean {
  return entry.state === 'waiting' && (!isSoftWaiting(entry) || entry.unread);
}

export function sessionHubBar(items: readonly AttentionItem[]): SessionHubBarModel {
  const counts: SessionHubCounts = { working: 0, waiting: 0, done: 0, failed: 0 };
  for (const entry of items) {
    if (entry.state === 'working') counts.working += 1;
    else if (countsAsWaiting(entry)) counts.waiting += 1;
    else if (entry.state === 'done' && entry.unread) counts.done += 1;
    else if (entry.state === 'failed' && entry.unread) counts.failed += 1;
  }
  const parts = [`работают ${counts.working}`, `ждут ${counts.waiting}`, `готово ${counts.done}`];
  if (counts.failed > 0) parts.push(`упали ${counts.failed}`);
  return {
    counts,
    label: parts.join(' · '),
    visible: counts.working + counts.waiting + counts.done + counts.failed > 0,
  };
}

/** Списки панели: ждут, работают, упали, готово; внутри — свежие сверху. */
export function sessionHubGroups(items: readonly AttentionItem[]): SessionHubGroup[] {
  const sorted = [...items].sort((a, b) => timeOf(b) - timeOf(a));
  return GROUPS.map(({ key, title }) => {
    const list = sorted.filter((entry) => entry.state === key);
    return { key, title, items: key === 'done' ? list.slice(0, DONE_LIMIT) : list };
  }).filter((group) => group.items.length > 0);
}

/**
 * «Прочитано» снимает только отметку: работающий чат и открытый запрос не
 * трогаются (их закрывает только ответ), прочитанное второй раз не метится.
 */
export function canMarkRead(entry: AttentionItem): boolean {
  return isSeenable(entry) && entry.unread;
}

/**
 * «Прочитать всё» видно, только когда есть что пометить. Сервер по
 * `{all:true}` метит то же, что и `canMarkRead`: открытые запросы остаются.
 */
export function canMarkAllRead(items: readonly AttentionItem[]): boolean {
  return items.some(canMarkRead);
}

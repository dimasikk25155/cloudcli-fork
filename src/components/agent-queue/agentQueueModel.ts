// Панель «Конвейер»: чистые правила, которые видит человек. Данные приходят с
// /api/agent-queue (server/modules/agent-queue); пределы — те же, что проверяет сервер.

export type QueueStatus = 'running' | 'paused' | 'stopped' | 'done';
export type QueueCounts = { pending: number; running: number; ok: number; rejected: number; total: number };

export type QueueSummary = {
  id: string;
  agentId: string;
  /** null — агента удалили. */
  agentName: string | null;
  title: string;
  template: string;
  parallel: number;
  maxAttempts: number;
  status: QueueStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  counts: QueueCounts;
};

export type QueueItem = {
  id: number;
  position: number;
  input: string;
  status: 'pending' | 'running' | 'ok' | 'rejected';
  attempts: number;
  pass: number;
  verdict: 'ok' | 'fail' | null;
  reason: string | null;
  excerpt: string | null;
  sessionId: string | null;
  manual: boolean;
  updatedAt: string;
};

export type QueueView = QueueSummary & { items: QueueItem[] };

export type QueueForm = {
  agentId: string;
  title: string;
  template: string;
  itemsText: string;
  parallel: number;
  maxAttempts: number;
};

export type QueueFormField = 'agentId' | 'items' | 'template' | 'parallel' | 'maxAttempts';
export type QueueFormErrors = Partial<Record<QueueFormField, string>>;

export type QueuePayload = {
  agentId: string;
  title: string | undefined;
  template: string;
  items: string[];
  parallel: number;
  maxAttempts: number;
};

export type QueueAction = 'pause' | 'resume' | 'stop' | 'retry' | 'delete';

export const QUEUE_ITEMS_MAX = 500;
export const QUEUE_ITEM_MAX_CHARS = 2000;
export const QUEUE_TEMPLATE_MAX_CHARS = 8000;
export const QUEUE_PARALLEL_MAX = 3;
export const QUEUE_ATTEMPTS_MAX = 4;
export const QUEUE_ITEM_PLACEHOLDER = '{{item}}';
/** Опрос, пока панель открыта. */
export const QUEUE_POLL_MS = 5_000;

export function itemsFromText(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function emptyQueueForm(agentId: string): QueueForm {
  return { agentId, title: '', template: '', itemsText: '', parallel: 1, maxAttempts: 2 };
}

export function validateQueueForm(form: QueueForm): QueueFormErrors {
  const errors: QueueFormErrors = {};
  if (!form.agentId) errors.agentId = 'Выбери агента';
  const items = itemsFromText(form.itemsText);
  if (items.length === 0) errors.items = 'Нет пунктов: впиши хотя бы один (по строке)';
  else if (items.length > QUEUE_ITEMS_MAX) errors.items = `Не больше ${QUEUE_ITEMS_MAX} пунктов, сейчас ${items.length}`;
  else {
    const long = items.findIndex((item) => item.length > QUEUE_ITEM_MAX_CHARS);
    if (long >= 0) errors.items = `Пункт ${long + 1} длиннее ${QUEUE_ITEM_MAX_CHARS} знаков`;
  }
  if (form.template.trim().length > QUEUE_TEMPLATE_MAX_CHARS) errors.template = `Шаблон длиннее ${QUEUE_TEMPLATE_MAX_CHARS} знаков`;
  if (!Number.isInteger(form.parallel) || form.parallel < 1 || form.parallel > QUEUE_PARALLEL_MAX) {
    errors.parallel = `Параллельно — от 1 до ${QUEUE_PARALLEL_MAX}`;
  }
  if (!Number.isInteger(form.maxAttempts) || form.maxAttempts < 1 || form.maxAttempts > QUEUE_ATTEMPTS_MAX) {
    errors.maxAttempts = `Попыток — от 1 до ${QUEUE_ATTEMPTS_MAX}`;
  }
  return errors;
}

export function toQueuePayload(form: QueueForm): QueuePayload {
  return {
    agentId: form.agentId,
    // Пустое название сервер заменит именем агента.
    title: form.title.trim() || undefined,
    template: form.template.trim(),
    items: itemsFromText(form.itemsText),
    parallel: form.parallel,
    maxAttempts: form.maxAttempts,
  };
}

/** Подсказка под шаблоном: куда встанет пункт. null — всё как написано. */
export function templateNote(template: string): string | null {
  const trimmed = template.trim();
  if (!trimmed) return 'Шаблона нет — заданием будет пункт целиком.';
  if (trimmed.includes(QUEUE_ITEM_PLACEHOLDER)) return null;
  return 'В шаблоне нет {{item}} — пункт допишется в конец задания.';
}

export function countsLine(counts: QueueCounts): string {
  return `в работе ${counts.running} · OK ${counts.ok} · брак ${counts.rejected} · ждут ${counts.pending}`;
}

/** Сколько пунктов закончено (OK или брак), в процентах. */
export function progressPercent(counts: QueueCounts): number {
  if (counts.total <= 0) return 0;
  return Math.round(((counts.ok + counts.rejected) / counts.total) * 100);
}

const QUEUE_STATUS: Record<QueueStatus, string> = {
  running: 'идёт',
  paused: 'на паузе',
  stopped: 'остановлена',
  done: 'готово',
};

export function queueStatusLabel(status: QueueStatus): string {
  return QUEUE_STATUS[status] ?? status;
}

export function itemStatusLabel(item: QueueItem): string {
  switch (item.status) {
    case 'running': return 'в работе';
    case 'ok': return item.manual ? 'OK (вручную)' : 'OK';
    case 'rejected': return 'брак';
    default: return item.verdict === 'fail' ? 'ждёт переделки' : 'ждёт';
  }
}

export function attemptsLabel(item: QueueItem, maxAttempts: number): string {
  if (item.attempts <= 0) return 'попыток не было';
  const base = `попытка ${item.attempts} из ${maxAttempts}`;
  return item.pass > 1 ? `${base} · проход ${item.pass}` : base;
}

/** Сервер разрешает «Отметить OK» только браку и FAIL, ждущему переделки. */
export function canMarkOk(item: QueueItem): boolean {
  return item.status === 'rejected' || (item.status === 'pending' && item.verdict === 'fail');
}

/** Кнопки очереди по правилам сервера (409 QUEUE_STATE на остальное). */
export function queueActions(queue: QueueSummary): QueueAction[] {
  const actions: QueueAction[] = [];
  if (queue.status === 'running') actions.push('pause');
  if (queue.status === 'paused') actions.push('resume');
  if (queue.status === 'running' || queue.status === 'paused') actions.push('stop');
  if (queue.status !== 'stopped' && queue.counts.rejected > 0) actions.push('retry');
  // Идущую очередь сначала ставят на паузу: исполнители в работе дописали бы в удалённое.
  if (queue.status !== 'running') actions.push('delete');
  return actions;
}

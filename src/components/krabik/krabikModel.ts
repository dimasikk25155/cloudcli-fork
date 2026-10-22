import type { CrabState } from '../crabs/crabModel';

// Окно «Агент крабик»: чистые правила, которые видит человек. Данные приходят
// с /api/krabik (server/modules/krabik).

export type KrabikStatus = 'idle' | 'working' | 'blocked' | 'unknown';

export type KrabikMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  at: string | null;
};

export type KrabikStateResponse = {
  reachable: boolean;
  status: KrabikStatus;
  title: string;
  completionSeq: number;
  error?: string;
  messages: KrabikMessage[];
};

export type KrabikReport = {
  name: string;
  mtime: number;
  status: 'ok' | 'problem' | 'none';
  summary: string;
};

export type KrabikView = {
  crab: CrabState;
  label: string;
  tone: 'ok' | 'busy' | 'warning' | 'muted';
  /** Показать кнопку «Разбудить». */
  canWake: boolean;
  /** Показать кнопку «Стоп». */
  canStop: boolean;
};

/** Как выглядит краб и что написано рядом. */
export function krabikView(state: Pick<KrabikStateResponse, 'reachable' | 'status'> | null): KrabikView {
  if (!state) return { crab: 'lost', label: 'Подключаюсь…', tone: 'muted', canWake: false, canStop: false };
  if (!state.reachable) {
    return { crab: 'failed', label: 'Нет связи с сервером', tone: 'muted', canWake: true, canStop: false };
  }
  switch (state.status) {
    case 'working':
      return { crab: 'running', label: 'Работает', tone: 'busy', canWake: false, canStop: true };
    case 'blocked':
      return { crab: 'lost', label: 'Ждёт твоего ответа', tone: 'warning', canWake: false, canStop: true };
    case 'idle':
      return { crab: 'done', label: 'Свободен — дай задачу', tone: 'ok', canWake: false, canStop: false };
    default:
      return { crab: 'lost', label: 'Спит — нажми «Разбудить»', tone: 'muted', canWake: true, canStop: false };
  }
}

/** Пока работает или ждёт — опрос чаще. */
export function pollDelayMs(status: KrabikStatus | undefined): number {
  return status === 'working' || status === 'blocked' ? 3000 : 15000;
}

/** Готовые задачи — то, что спрашивают чаще всего. */
export const QUICK_TASKS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: 'Проверь всех ботов',
    prompt: 'Проверь всех ботов и службы: что упало, что часто перезапускается. Что можно — почини сам, остальное опиши.',
  },
  {
    label: 'Что упало за ночь?',
    prompt: 'Что ломалось или перезапускалось за последние 12 часов? Коротко: что, когда, почему, починилось ли.',
  },
  {
    label: 'Почисти место',
    prompt: 'Освободи место на диске безопасно: журналы, кэши, временные файлы. Бэкапы и данные не трогай — только предложи.',
  },
  {
    label: 'Почему тормозит?',
    prompt: 'Сервер тормозит? Проверь нагрузку, память, подкачку и самые тяжёлые процессы. Объясни простыми словами.',
  },
  {
    label: 'Последний отчёт',
    prompt: 'Перескажи в 5 строках свой последний отчёт из reports/.',
  },
];

/** «12:40» сегодня, иначе «21.10 12:40». */
export function shortWhen(at: string | number | null | undefined, now: Date = new Date()): string {
  if (at === null || at === undefined || at === '') return '';
  const date = typeof at === 'number' ? new Date(at * 1000) : new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return time;
  const day = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  return `${day} ${time}`;
}

/** Человеческое имя отчёта: без даты в начале, расширения и дефисов. */
export function reportTitle(name: string): string {
  const base = name.replace(/\.md$/i, '');
  if (/^duty-\d{4}-\d{2}-\d{2}$/.test(base)) return 'Утреннее дежурство';
  return base.replace(/^\d{4}-\d{2}-\d{2}-?/, '').replace(/[-_]+/g, ' ').trim() || base;
}

/** Дата из имени отчёта, если есть: «23.10». */
export function reportDay(name: string): string {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
  return match ? `${match[3]}.${match[2]}` : '';
}

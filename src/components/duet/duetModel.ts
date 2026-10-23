// Окно «Дуэт»: типы ответа /api/duet/state и чистые функции для панели и хаба.
// Сервер — server/modules/duet (там же описано, что делает Дуэт).

export type DuetStatus = 'up' | 'down' | 'idle' | 'unreachable' | 'missing' | 'unknown';
export type DuetChoice = 'restart' | 'fix' | 'mute' | 'dismiss';

export type DuetServiceRow = {
  id: string;
  machine: string;
  method: string;
  target: string;
  crit: boolean;
  label: string;
  status: DuetStatus;
  since: string;
  detail?: string;
  muted: boolean;
  project: { path: string; guessed: boolean } | null;
  canRestart: boolean;
  ideas: number;
};

export type DuetDecisionStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'expired';

export type DuetDecision = {
  id: string;
  createdAt: string;
  source: 'watch' | 'brief';
  serviceId: string;
  title: string;
  body: string;
  options: Array<{ choice: DuetChoice; label: string }>;
  status: DuetDecisionStatus;
  chosen?: DuetChoice;
  decidedAt?: string;
  via?: 'ui' | 'telegram';
  result?: string;
  sessionId?: string | null;
};

export type DuetIdea = {
  id: string;
  serviceId: string;
  title: string;
  why: string;
  effort: 'S' | 'M' | 'L';
  status: 'new' | 'running' | 'done' | 'failed' | 'dismissed';
  createdAt: string;
  result?: string;
  sessionId?: string | null;
};

export type DuetBrief = { id: string; at: string; kind: 'morning' | 'manual' | 'incident'; text: string; error?: string };
export type DuetEvent = { id: string; at: string; kind: string; text: string; serviceId?: string };

export type DuetSettings = {
  briefTime: string;
  checkEveryMin: number;
  ideasEveryDays: number;
  muted: string[];
  projects: Record<string, string>;
};

export type DuetStateResponse = {
  settings: DuetSettings;
  checkedAt: string | null;
  nextCheckAt: string;
  nextBriefAt: string;
  lastIdeasAt: string | null;
  services: DuetServiceRow[];
  decisions: DuetDecision[];
  ideas: DuetIdea[];
  briefs: DuetBrief[];
  events: DuetEvent[];
  job: { kind: string; label: string; startedAt: string } | null;
  queue: string[];
  checking: boolean;
  projects: string[];
};

export const STATUS_META: Record<DuetStatus, { label: string; dot: string; text: string }> = {
  up: { label: 'работает', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  idle: { label: 'ждёт по расписанию', dot: 'bg-sky-400', text: 'text-sky-600 dark:text-sky-400' },
  down: { label: 'лежит', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  missing: { label: 'нет на машине', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  unreachable: { label: 'машина не отвечает', dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400' },
  unknown: { label: 'не проверить', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
};

export const MACHINE_TITLE: Record<string, string> = {
  'vps-nl': 'Сервер NL',
  mac: 'Мак',
  windows: 'Windows',
};

const MACHINE_ORDER = ['vps-nl', 'mac', 'windows'];

export const EFFORT_LABEL: Record<DuetIdea['effort'], string> = { S: 'на час', M: 'на вечер', L: 'на пару дней' };

export const DECISION_STATUS: Record<DuetDecisionStatus, { label: string; tone: 'muted' | 'busy' | 'ok' | 'bad' }> = {
  pending: { label: 'ждёт тебя', tone: 'busy' },
  running: { label: 'в работе', tone: 'busy' },
  done: { label: 'готово', tone: 'ok' },
  failed: { label: 'не вышло', tone: 'bad' },
  skipped: { label: 'не трогали', tone: 'muted' },
  expired: { label: 'снято', tone: 'muted' },
};

export function isBroken(status: DuetStatus): boolean {
  return status === 'down' || status === 'missing';
}

/** «pulse-bot — Brand-дашборд/пульс, бот» → «pulse-bot». */
export function shortName(label: string): string {
  return label.split(' — ')[0].trim() || label;
}

export function describe(label: string): string {
  const rest = label.split(' — ').slice(1).join(' — ').trim();
  return rest;
}

export type DuetSummary = { total: number; ok: number; broken: number; unreachable: number; muted: number };

export function summarize(services: readonly DuetServiceRow[]): DuetSummary {
  const watched = services.filter((service) => !service.muted);
  return {
    total: services.length,
    ok: watched.filter((service) => service.status === 'up' || service.status === 'idle').length,
    broken: watched.filter((service) => isBroken(service.status)).length,
    unreachable: watched.filter((service) => service.status === 'unreachable').length,
    muted: services.length - watched.length,
  };
}

/** Строка-итог для шапки: «Всё работает» / «Лежат 2 из 33». */
export function summaryLine(summary: DuetSummary): string {
  if (summary.total === 0) return 'Ещё не проверял';
  if (summary.broken === 0 && summary.unreachable === 0) return `Всё работает · ${summary.ok} из ${summary.total - summary.muted}`;
  const parts = [];
  if (summary.broken > 0) parts.push(`${plural(summary.broken, 'лежит', 'лежат', 'лежат')} ${summary.broken}`);
  if (summary.unreachable > 0) parts.push(`не отвечает ${summary.unreachable}`);
  return `${parts.join(', ')} · работает ${summary.ok}`;
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Сломанное и критичное — наверх; заглушённое — вниз. */
export function sortServices(services: readonly DuetServiceRow[]): DuetServiceRow[] {
  const rank = (service: DuetServiceRow) => {
    if (service.muted) return 5;
    if (isBroken(service.status)) return 0;
    if (service.status === 'unreachable') return 1;
    if (service.status === 'unknown') return 2;
    return 3;
  };
  return [...services].sort((a, b) =>
    rank(a) - rank(b)
    || Number(b.crit) - Number(a.crit)
    || shortName(a.label).localeCompare(shortName(b.label), 'ru'));
}

export function groupByMachine(services: readonly DuetServiceRow[]): Array<{ machine: string; title: string; services: DuetServiceRow[] }> {
  const machines = [...new Set(services.map((service) => service.machine))].sort((a, b) => {
    const ia = MACHINE_ORDER.indexOf(a);
    const ib = MACHINE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return machines.map((machine) => ({
    machine,
    title: MACHINE_TITLE[machine] ?? machine,
    services: sortServices(services.filter((service) => service.machine === machine)),
  }));
}

export function pendingDecisions(state: Pick<DuetStateResponse, 'decisions'> | null): DuetDecision[] {
  return (state?.decisions ?? []).filter((decision) => decision.status === 'pending');
}

export function activeDecisions(state: Pick<DuetStateResponse, 'decisions'> | null): DuetDecision[] {
  return (state?.decisions ?? []).filter((decision) => decision.status === 'pending' || decision.status === 'running');
}

/** Пока Дуэт что-то делает — опрос чаще. */
export function pollDelayMs(state: Pick<DuetStateResponse, 'job' | 'checking' | 'decisions'> | null): number {
  if (!state) return 4000;
  if (state.job || state.checking || state.decisions.some((decision) => decision.status === 'running')) return 4000;
  return 20_000;
}

export function mskClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

/** «5 мин назад», «вчера в 08:30», «23.10 в 08:30». */
export function whenAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const at = new Date(iso);
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (Number.isNaN(minutes)) return '—';
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 12) return `${hours} ч назад`;
  const day = (date: Date) => date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' });
  const yesterday = new Date(now.getTime() - 24 * 3600_000);
  if (day(at) === day(now)) return `сегодня в ${mskClock(iso)}`;
  if (day(at) === day(yesterday)) return `вчера в ${mskClock(iso)}`;
  return `${day(at)} в ${mskClock(iso)}`;
}

/** «через 12 мин» до следующей проверки. */
export function untilText(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const minutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (Number.isNaN(minutes)) return '—';
  if (minutes <= 0) return 'сейчас';
  if (minutes < 60) return `через ${minutes} мин`;
  return `в ${mskClock(iso)}`;
}

const BRIEF_KIND: Record<DuetBrief['kind'], string> = {
  morning: 'Утренний бриф',
  manual: 'Бриф по кнопке',
  incident: 'Разбор аварии',
};

export function briefTitle(brief: DuetBrief): string {
  return BRIEF_KIND[brief.kind] ?? 'Бриф';
}

export function projectName(projectPath: string | null | undefined): string {
  if (!projectPath) return '';
  const parts = projectPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

/** Идеи по сервису: свежие сверху, сделанные внизу. */
export function ideasFor(ideas: readonly DuetIdea[], serviceId: string): DuetIdea[] {
  const rank: Record<DuetIdea['status'], number> = { running: 0, new: 1, failed: 2, done: 3, dismissed: 4 };
  return ideas
    .filter((idea) => idea.serviceId === serviceId && idea.status !== 'dismissed')
    .sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.localeCompare(a.createdAt));
}

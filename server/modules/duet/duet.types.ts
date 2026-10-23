/**
 * «Дуэт» — напарник Димы по ботам и сервисам (свой аналог Claude Duet).
 * Типы общего состояния: файл `~/.cloudcli/duet/state.json` и ответ `/api/duet/state`.
 */

export type DuetMethod = 'systemd' | 'docker' | 'http' | 'launchd' | 'heartbeat';

/** `idle` — загружен и ждёт своего часа (таймер, launchd по требованию): это норма. */
export type DuetStatus = 'up' | 'down' | 'idle' | 'unreachable' | 'missing' | 'unknown';

export type DuetService = {
  /** Короткий стабильный id (хэш machine+method+target) — годится в URL и callback_data. */
  id: string;
  machine: string;
  method: DuetMethod;
  target: string;
  crit: boolean;
  label: string;
  /** Папка проекта, известная заранее (пульс WA-бота знает свою). */
  projectHint?: string;
};

export type DuetServiceState = DuetService & {
  status: DuetStatus;
  /** С какого момента держится этот статус. */
  since: string;
  detail?: string;
};

export type DuetSnapshot = { checkedAt: string; services: DuetServiceState[] };

/** Что Дима может выбрать по решению. */
export type DuetChoice = 'restart' | 'fix' | 'mute' | 'dismiss';

export type DuetDecisionOption = {
  choice: DuetChoice;
  label: string;
  /** sha256 одноразового токена кнопки Telegram; сам токен хранится только в кнопке. */
  tokenHash: string;
};

export type DuetDecisionStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'expired';

export type DuetDecision = {
  id: string;
  createdAt: string;
  source: 'watch' | 'brief';
  serviceId: string;
  title: string;
  body: string;
  /** Первым идёт то, что Дуэт советует. */
  options: DuetDecisionOption[];
  status: DuetDecisionStatus;
  chosen?: DuetChoice;
  decidedAt?: string;
  via?: 'ui' | 'telegram';
  result?: string;
  sessionId?: string | null;
  telegram?: { chatId: string; messageId: number };
};

export type DuetIdeaStatus = 'new' | 'running' | 'done' | 'failed' | 'dismissed';

export type DuetIdea = {
  id: string;
  serviceId: string;
  title: string;
  why: string;
  effort: 'S' | 'M' | 'L';
  status: DuetIdeaStatus;
  createdAt: string;
  result?: string;
  sessionId?: string | null;
};

export type DuetBriefKind = 'morning' | 'manual' | 'incident';

export type DuetBrief = {
  id: string;
  at: string;
  kind: DuetBriefKind;
  text: string;
  error?: string;
  sessionId?: string | null;
};

export type DuetEventKind = 'down' | 'up' | 'brief' | 'action' | 'ideas' | 'skip' | 'error';

export type DuetEvent = { id: string; at: string; kind: DuetEventKind; text: string; serviceId?: string };

export type DuetSettings = {
  /** Время утреннего брифа по Москве, «HH:MM». */
  briefTime: string;
  checkEveryMin: number;
  ideasEveryDays: number;
  /** id сервисов, за которыми Дуэт не следит (намеренно выключены). */
  muted: string[];
  /** id сервиса → папка проекта (ручная привязка; без неё — угадывание). */
  projects: Record<string, string>;
};

export type DuetJobKind = 'brief' | 'ideas' | 'fix' | 'idea';

export type DuetJob = { kind: DuetJobKind; label: string; startedAt: string };

export type DuetState = {
  version: 1;
  settings: DuetSettings;
  snapshot: DuetSnapshot | null;
  lastBriefAt: string | null;
  lastIncidentBriefAt: string | null;
  lastIdeasAt: string | null;
  briefs: DuetBrief[];
  events: DuetEvent[];
  decisions: DuetDecision[];
  ideas: DuetIdea[];
};

export const DEFAULT_SETTINGS: DuetSettings = {
  briefTime: '08:30',
  checkEveryMin: 15,
  ideasEveryDays: 7,
  muted: [],
  projects: {},
};

export function emptyState(): DuetState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, muted: [], projects: {} },
    snapshot: null,
    lastBriefAt: null,
    lastIncidentBriefAt: null,
    lastIdeasAt: null,
    briefs: [],
    events: [],
    decisions: [],
    ideas: [],
  };
}

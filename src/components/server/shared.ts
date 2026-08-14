import { authenticatedFetch } from '../../utils/api';

// Общее для вкладок панели «Сервер»: типы ответов API, форматирование и
// мелкие кирпичики вёрстки. Строки заданы прямо здесь — общие файлы i18n
// форк не трогает.

export type Overview = {
  hostname: string;
  os: string;
  kernel: string;
  uptimeSec: number;
  loadavg: [number, number, number];
  cpuCores: number;
  cpuPct: number;
  mem: { totalBytes: number; usedBytes: number; availableBytes: number; pct: number };
  swap: { totalBytes: number; usedBytes: number; pct: number };
  disks: Array<{ mount: string; totalBytes: number; usedBytes: number; pct: number }>;
  net: { rxBytes: number; txBytes: number; rxRate: number; txRate: number };
  procCount: number;
};

export type ServiceInfo = {
  unit: string;
  name: string;
  description: string;
  state: string;
  sub: string;
  enabled: string;
  uptimeSec: number | null;
  memoryBytes: number | null;
  pid: number | null;
  restarts: number;
  own: boolean;
  controllable: boolean;
  health: 'up' | 'down' | 'failed' | 'flapping' | 'idle';
};

export type LogLine = { ts: string; level: 'error' | 'warn' | 'info' | 'system'; text: string };

export type Diagnosis = {
  unit: string;
  enabled: string;
  result: string | null;
  exitCode: number | null;
  restarts: number;
  restartSec: string | null;
  execStart: string | null;
  logPath: string | null;
  lastError: string | null;
  reason: string | null;
  advice: string | null;
  needsHuman?: boolean;
};

export type ErrorGroup = { source: string; text: string; count: number; lastTs: string };

export type Inventory = {
  containers: Array<{ name: string; image: string; status: string; ports: string }>;
  dockerAvailable: boolean;
  dockerInstalled: boolean;
  ports: Array<{ addr: string; proc: string }>;
  topProcesses: Array<{ pid: number; name: string; cpu: number; rssBytes: number }>;
  folders: Array<{ path: string; sizeMb: number }>;
  foldersAvailable: boolean;
  runtimes: { node: string | null; python: string | null; postgres: string | null; docker: string | null };
};

export type HostReport = {
  host: string;
  label: string;
  cpuPct: number | null;
  ramPct: number | null;
  diskPct: number | null;
  gpuPct: number | null;
  services: Array<{ name: string; up: boolean }>;
  ageSec: number | null;
  stale: boolean;
  source: 'neo3' | 'pulse';
};

export type AlertSettings = {
  enabled: boolean;
  chatId: string | null;
  diskPct: number;
  ramPct: number;
  restarts: number;
  muted: string[];
};

export type AlertsPayload = {
  settings: AlertSettings;
  chatId: string | null;
  ingestToken: string;
  problems: Array<{ key: string; text: string }>;
};

export type Feedback = { ok: boolean; text: string } | null;

export type ServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable';

// ------------------------------------------------------------------- запросы

export async function readJson(url: string) {
  const response = await authenticatedFetch(url);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.error || `Запрос не прошёл (${response.status})`);
  }
  return body?.data ?? body;
}

// --------------------------------------------------------------- форматирование

export function bytes(value: number | null | undefined): string {
  if (!value || value < 0) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин`;
  return `${Math.max(0, Math.round(seconds))} сек`;
}

/** Порог, после которого метрика перестаёт быть «нормальной». */
export function tone(pct: number): { bar: string; text: string } {
  if (pct >= 90) return { bar: 'bg-red-500', text: 'text-red-500' };
  if (pct >= 75) return { bar: 'bg-amber-500', text: 'text-amber-500' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-500' };
}

export const HEALTH_STYLE: Record<ServiceInfo['health'], { dot: string; label: string }> = {
  up: { dot: 'bg-emerald-500', label: 'работает' },
  idle: { dot: 'bg-sky-500', label: 'отработал' },
  down: { dot: 'bg-zinc-500', label: 'выключен' },
  failed: { dot: 'bg-red-500', label: 'упал' },
  flapping: { dot: 'bg-amber-500', label: 'падает по кругу' },
};

/** Русское склонение по числу: 1 сервис, 2 сервиса, 5 сервисов. */
export function plural(count: number, forms: [string, string, string]): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/**
 * Название сервиса для человека.
 *
 * `crypta-bg-repost` ни о чём не говорит, а systemd-описание — говорит:
 * «Crypta BG repost — @crypto_hd → @vtemechannel1». Оно и идёт заголовком,
 * имя юнита остаётся мелкой строкой для тех, кто полезет в терминал.
 */
export function humanName(service: ServiceInfo): string {
  const description = service.description?.trim();
  if (!description) return service.name;
  if (description.toLowerCase() === service.name.toLowerCase()) return service.name;
  if (/^\S+\.service$/i.test(description)) return service.name;
  return description;
}

/**
 * Готовое задание агенту по конкретной аварии.
 *
 * Дима нажимает «Починить», текст ложится в чат — и остаётся только отправить.
 * Пересказывать причину и лог руками (тем более с телефона) он не должен.
 */
export function fixPrompt(service: ServiceInfo, diagnosis?: Diagnosis | null): string {
  const lines = [
    `Сервис «${humanName(service)}» (юнит ${service.unit}) не работает: ${HEALTH_STYLE[service.health].label}` +
      (service.restarts > 0 ? `, перезапусков ${service.restarts}.` : '.'),
  ];

  if (diagnosis?.reason) lines.push(`Панель определила причину: ${diagnosis.reason}`);
  if (diagnosis?.advice) lines.push(`Совет панели: ${diagnosis.advice}`);
  if (diagnosis?.lastError) lines.push(`Последняя ошибка из лога:\n${diagnosis.lastError.slice(0, 600)}`);
  if (diagnosis?.logPath) lines.push(`Лог сервиса: ${diagnosis.logPath}`);

  lines.push(
    'Разберись и почини. Если без меня не обойтись (новый вход, токен, код подтверждения) — ' +
      'скажи одной строкой, что мне сделать.',
  );

  return lines.join('\n');
}

/** Одна строка про сервис: сколько живёт, сколько ест, сколько раз падал. */
export function serviceStats(service: ServiceInfo): string {
  return [
    service.health === 'up' && service.uptimeSec != null ? duration(service.uptimeSec) : null,
    service.memoryBytes ? bytes(service.memoryBytes) : null,
    service.restarts > 0 ? `перезапусков ${service.restarts}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appConfigDb, telegramDb } from '@/modules/database/index.js';
import { isBotConfigured, telegramApi } from '@/modules/telegram/index.js';
import { maybeSyncConsigliere, syncDeadBots } from '@/modules/sticky-push/sticky-push.service.js';
import { listRemoteHosts } from '@/modules/vps/vps-reports.service.js';
import { getOverview, listServices } from '@/modules/vps/vps.service.js';

// Сторож: раз в минуту смотрит на машину и пишет в Телеграм, когда что-то
// сломалось или починилось. Заменяет alert_loop из «Пульта жизни».
//
// Важное ограничение, которое честнее назвать вслух: этот сторож живёт ВНУТРИ
// Neo3. Если ляжет сам Neo3 — он о себе не напишет. Внешнюю проверку «Neo3
// отвечает?» должен делать кто-то снаружи (ServerGuardian на Windows,
// см. SERVER-PANEL-SETUP.md).

const STATE_FILE = path.join(os.homedir(), '.cloudcli', 'vps-alerts-state.json');
const SETTINGS_KEY = 'vps_alerts';
const CHECK_INTERVAL_MS = 60_000;

export type AlertSettings = {
  enabled: boolean;
  chatId: string | null;
  diskPct: number;
  ramPct: number;
  /** Сколько перезапусков подряд считать «бот падает по кругу». */
  restarts: number;
  /** Сервисы, о которых не сообщать (шумные или намеренно выключенные). */
  muted: string[];
};

const DEFAULTS: AlertSettings = {
  enabled: false,
  chatId: null,
  diskPct: 90,
  ramPct: 95,
  restarts: 5,
  muted: [],
};

export function getSettings(): AlertSettings {
  try {
    const raw = appConfigDb.get(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AlertSettings>;
    return {
      ...DEFAULTS,
      ...parsed,
      muted: Array.isArray(parsed.muted) ? parsed.muted.map(String) : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<AlertSettings>): AlertSettings {
  const next: AlertSettings = { ...getSettings(), ...patch };
  next.diskPct = Math.min(Math.max(Number(next.diskPct) || DEFAULTS.diskPct, 50), 99);
  next.ramPct = Math.min(Math.max(Number(next.ramPct) || DEFAULTS.ramPct, 50), 99);
  next.restarts = Math.min(Math.max(Number(next.restarts) || DEFAULTS.restarts, 2), 1000);
  appConfigDb.set(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/**
 * Куда слать. Явно выбранный чат важнее; иначе берём привязанный к Neo3 —
 * чтобы алерты заработали сразу после привязки бота, без второй настройки.
 */
export function resolveChatId(settings: AlertSettings = getSettings()): string | null {
  if (settings.chatId) return settings.chatId;
  try {
    const bindings = telegramDb.listBindings?.() ?? [];
    return bindings.length > 0 ? String(bindings[0].chat_id) : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- состояние

type AlertState = Record<string, { since: number; text: string }>;

let state: AlertState = {};
let stateLoaded = false;

async function loadState(): Promise<void> {
  if (stateLoaded) return;
  try {
    state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) as AlertState;
  } catch {
    state = {};
  }
  stateLoaded = true;
}

async function persistState(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state), 'utf8');
  } catch {
    // Не смогли сохранить — переживём: худшее, что будет, это повтор алерта.
  }
}

// ----------------------------------------------------------------- правила

type Problem = { key: string; text: string };

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Собирает список проблем «прямо сейчас». Ключ должен быть стабильным. */
export async function collectProblems(settings: AlertSettings = getSettings()): Promise<Problem[]> {
  const problems: Problem[] = [];
  const muted = new Set(settings.muted);

  const [overview, services, hosts] = await Promise.all([
    getOverview().catch(() => null),
    listServices().catch(() => []),
    listRemoteHosts().catch(() => []),
  ]);

  for (const service of services) {
    if (muted.has(service.unit) || muted.has(service.name)) continue;
    if (service.health === 'failed') {
      problems.push({ key: `svc:${service.unit}:failed`, text: `сервис <b>${escapeHtml(service.name)}</b> упал` });
    } else if (service.health === 'flapping' && service.restarts >= settings.restarts) {
      problems.push({
        key: `svc:${service.unit}:flapping`,
        text: `<b>${escapeHtml(service.name)}</b> падает по кругу — перезапусков ${service.restarts}`,
      });
    }
  }

  if (overview) {
    for (const disk of overview.disks) {
      if (disk.pct >= settings.diskPct) {
        problems.push({ key: `disk:${disk.mount}`, text: `диск <b>${escapeHtml(disk.mount)}</b> занят на ${disk.pct}%` });
      }
    }
    if (overview.mem.pct >= settings.ramPct) {
      problems.push({ key: 'ram', text: `память занята на ${overview.mem.pct}%` });
    }
  }

  for (const host of hosts) {
    if (muted.has(host.host)) continue;
    if (host.stale) {
      problems.push({
        key: `host:${host.host}:silent`,
        text: `машина <b>${escapeHtml(host.label)}</b> молчит${host.ageSec ? ` ${Math.round(host.ageSec / 60)} мин` : ''}`,
      });
    } else if (host.diskPct != null && host.diskPct >= settings.diskPct) {
      problems.push({
        key: `host:${host.host}:disk`,
        text: `на машине <b>${escapeHtml(host.label)}</b> диск занят на ${host.diskPct}%`,
      });
    }
  }

  return problems;
}

async function send(chatId: string, text: string): Promise<void> {
  // 4096 — предел Телеграма; режем с запасом, длинные простыни всё равно не читают.
  await telegramApi.sendMessage(chatId, text.slice(0, 3800));
}

/**
 * Один проход сторожа: сравнивает «сейчас» с прошлым разом и шлёт только
 * изменения — появившиеся проблемы и починившиеся.
 *
 * `announce: false` (первый проход после старта) — состояние запоминается
 * молча, кроме одной сводки: иначе каждый рестарт Neo3 сыпал бы в чат
 * список всего, что и так давно лежит.
 */
export async function runCheck({ announce = true }: { announce?: boolean } = {}): Promise<{
  problems: Problem[];
  sent: string[];
}> {
  await loadState();
  const settings = getSettings();
  const sent: string[] = [];
  const problems = await collectProblems(settings);

  const current = new Map(problems.map((problem) => [problem.key, problem]));
  const appeared = problems.filter((problem) => !state[problem.key]);
  const resolved = Object.entries(state).filter(([key]) => !current.has(key));

  if (settings.enabled) {
    const chatId = resolveChatId(settings);
    const canSend = Boolean(chatId) && isBotConfigured();
    if (canSend && chatId) {
      if (!announce && appeared.length > 0) {
        // Сводка после запуска — одним сообщением, а не пачкой.
        const lines = appeared.map((problem) => `• ${problem.text}`).join('\n');
        await send(chatId, `🔴 <b>Neo3 запущен, есть проблемы</b>\n${lines}`).catch(() => undefined);
        sent.push('startup-summary');
      } else if (announce) {
        for (const problem of appeared) {
          await send(chatId, `🔴 ${problem.text}`).catch(() => undefined);
          sent.push(problem.key);
        }
        for (const [key, previous] of resolved) {
          await send(chatId, `🟢 починилось: ${previous.text}`).catch(() => undefined);
          sent.push(`resolved:${key}`);
        }
      }
    }
  }

  const next: AlertState = {};
  for (const problem of problems) {
    next[problem.key] = state[problem.key] ?? { since: Date.now(), text: problem.text };
  }
  state = next;
  await persistState();

  const forPush = problems.map((problem) => ({
    key: problem.key,
    text: problem.text,
    since: state[problem.key]?.since,
  }));
  await syncDeadBots(forPush).catch((error) => {
    console.error('[sticky-push] bots failed:', error instanceof Error ? error.message : error);
  });
  await maybeSyncConsigliere().catch((error) => {
    console.error('[sticky-push] consigliere failed:', error instanceof Error ? error.message : error);
  });

  return { problems, sent };
}

/** Тестовое сообщение — чтобы Дима убедился, что алерты дойдут, не ломая ничего. */
export async function sendTestMessage(): Promise<{ chatId: string }> {
  const settings = getSettings();
  const chatId = resolveChatId(settings);
  if (!isBotConfigured()) {
    throw new Error('Телеграм-бот не настроен: вставьте токен в Настройки → Telegram.');
  }
  if (!chatId) {
    throw new Error('Не указан чат для алертов: привяжите бота или впишите chat_id в настройках панели.');
  }
  const problems = await collectProblems(settings);
  const body =
    problems.length === 0
      ? '🟢 Проблем нет.'
      : `Сейчас вижу:\n${problems.map((problem) => `• ${problem.text}`).join('\n')}`;
  await send(chatId, `🔔 <b>Проверка связи из панели «Сервер»</b>\n${body}`);
  return { chatId };
}

// ------------------------------------------------------------------ таймер

let timer: NodeJS.Timeout | null = null;

export function startAlertLoop(): void {
  if (timer) return;
  // Первый проход — молчаливый, только сводка: сервер мог перезапуститься
  // посреди уже известной аварии.
  void runCheck({ announce: false }).catch(() => undefined);
  timer = setInterval(() => {
    void runCheck({ announce: true }).catch(() => undefined);
  }, CHECK_INTERVAL_MS);
  // Сторож не должен мешать процессу завершиться.
  timer.unref?.();
}

export function stopAlertLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

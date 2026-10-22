/**
 * Сторож Крабика: раз в 20 секунд смотрит его состояние и сообщает Диме
 * (пуш + Telegram), когда Крабик закончил задачу или ждёт ответа.
 *
 * - «Закончил» = вырос `completion_seq` Herdr. Если мак спал и пропустил
 *   несколько ходов — одно сообщение про последний, без лавины.
 * - Утреннее дежурство (задача начинается со слова «ДЕЖУРСТВО») молчит,
 *   пока в отчёте `duty-*.md` первая строка `СТАТУС: ОК`.
 * - После перезапуска Neo3 или Herdr первый проход только запоминает
 *   состояние: старое «закончил» не повторяется.
 *
 * Сторож живёт внутри Neo3 на маке: пока мак спит, сообщения не уходят —
 * сам Крабик и дежурство при этом работают на сервере.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { pushSubscriptionsDb, telegramDb, userDb } from '@/modules/database/index.js';
import {
  buildNotificationPayload,
  createNotificationEvent,
  sendDesktopNotification,
  sendWebPushPayload,
} from '@/modules/notifications/index.js';
import { isBotConfigured, telegramApi } from '@/modules/telegram/index.js';
import { isModOn } from '@/shared/mods.js';

import { krabikService, type KrabikMessage, type KrabikService, type KrabikState } from './krabik.service.js';

const CHECK_INTERVAL_MS = 20_000;
export const KRABIK_NOTICE_CODE = 'krabik.notice';
const DUTY_PREFIX = 'ДЕЖУРСТВО';

export type KrabikNotice = { kind: 'done' | 'waiting' | 'duty-problem'; title: string; body: string };

type WatchMemory = { seq: number; waiting: boolean };

export type KrabikWatchDeps = {
  service: Pick<KrabikService, 'getState' | 'getMessages' | 'listReports'>;
  notify: (notice: KrabikNotice) => Promise<void>;
  isOn: () => boolean;
  load: () => Promise<WatchMemory | null>;
  save: (memory: WatchMemory) => Promise<void>;
};

function shorten(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function last(messages: KrabikMessage[], role: KrabikMessage['role']): KrabikMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === role) return messages[i];
  }
  return undefined;
}

export function createKrabikWatch(deps: KrabikWatchDeps) {
  async function noticeForCompletion(state: KrabikState): Promise<KrabikNotice | null> {
    const messages = await deps.service.getMessages(30);
    const asked = last(messages, 'user')?.text ?? '';
    const answer = last(messages, 'assistant')?.text ?? '';
    if (asked.trim().startsWith(DUTY_PREFIX)) {
      const duty = (await deps.service.listReports()).find((report) => report.name.startsWith('duty-'));
      if (duty?.status !== 'problem') return null;
      return {
        kind: 'duty-problem',
        title: 'Крабик: на сервере проблема',
        body: shorten(duty.summary || answer || 'Утреннее дежурство нашло проблему', 220),
      };
    }
    return {
      kind: 'done',
      title: 'Крабик закончил',
      body: shorten(answer || state.title || 'Задача готова', 220),
    };
  }

  /** Один проход. Возвращает отправленное сообщение (для тестов) или null. */
  async function tick(): Promise<KrabikNotice[]> {
    if (!deps.isOn()) return [];
    const state = await deps.service.getState();
    if (!state.reachable) return [];
    const memory = await deps.load();
    const waiting = state.status === 'blocked';
    const next: WatchMemory = { seq: state.completionSeq, waiting };

    // Первый проход или Herdr перезапускался (счётчик начался заново) — молча запоминаем.
    if (!memory || state.completionSeq < memory.seq) {
      await deps.save(next);
      return [];
    }

    const sent: KrabikNotice[] = [];
    if (state.completionSeq > memory.seq && !waiting) {
      const notice = await noticeForCompletion(state);
      if (notice) sent.push(notice);
    }
    if (waiting && !memory.waiting) {
      const answer = last(await deps.service.getMessages(10), 'assistant')?.text ?? '';
      sent.push({ kind: 'waiting', title: 'Крабик ждёт ответа', body: shorten(answer || state.title || 'Открой окно Крабика', 220) });
    }
    for (const notice of sent) {
      await deps.notify(notice).catch(() => undefined);
    }
    await deps.save(next);
    return sent;
  }

  return { tick };
}

// ------------------------------------------------------------ боевые зависимости

function memoryPath(): string {
  return process.env.NEO3_KRABIK_WATCH_STATE || path.join(os.homedir(), '.cloudcli', 'krabik-watch.json');
}

async function loadMemory(): Promise<WatchMemory | null> {
  try {
    const raw = JSON.parse(await fs.readFile(memoryPath(), 'utf8'));
    return { seq: Number(raw.seq) || 0, waiting: Boolean(raw.waiting) };
  } catch {
    return null;
  }
}

async function saveMemory(memory: WatchMemory): Promise<void> {
  await fs.mkdir(path.dirname(memoryPath()), { recursive: true });
  await fs.writeFile(memoryPath(), JSON.stringify(memory));
}

/** Активные админы — им и уходит. Крабик есть только у владельца. */
function adminIds(): number[] {
  return userDb
    .listUsers()
    .filter((user: { role?: string; is_active?: number | string }) => user.role === 'admin' && Number(user.is_active) === 1)
    .map((user: { id: number | string }) => Number(user.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function notifyAdmins(notice: KrabikNotice): Promise<void> {
  const event = createNotificationEvent({
    provider: 'system',
    kind: 'info',
    code: KRABIK_NOTICE_CODE,
    meta: { title: notice.title, body: notice.body, kind: notice.kind },
    severity: notice.kind === 'done' ? 'info' : 'warning',
  });
  const payload = buildNotificationPayload(event);
  for (const userId of adminIds()) {
    if (pushSubscriptionsDb.getSubscriptions(userId).length > 0) {
      await sendWebPushPayload(userId, payload).catch(() => undefined);
    }
    try {
      sendDesktopNotification(userId, payload);
    } catch {
      // Настольное приложение может быть закрыто — пуш всё равно ушёл.
    }
  }
  try {
    const chatId = telegramDb.listBindings?.()?.[0]?.chat_id;
    if (chatId && isBotConfigured()) {
      const icon = notice.kind === 'done' ? '🦀' : notice.kind === 'waiting' ? '🦀❓' : '🦀🔴';
      await telegramApi.sendMessage(String(chatId), `${icon} <b>${escapeHtml(notice.title)}</b>\n${escapeHtml(notice.body)}`.slice(0, 3800));
    }
  } catch {
    // Telegram не настроен или недоступен — пуш уже ушёл.
  }
}

const watch = createKrabikWatch({
  service: krabikService,
  notify: notifyAdmins,
  isOn: () => {
    const owner = adminIds()[0];
    return owner !== undefined && isModOn(owner, 'modKrabikAgent');
  },
  load: loadMemory,
  save: saveMemory,
});

let timer: NodeJS.Timeout | null = null;
let busy = false;

export function startKrabikWatch(): void {
  if (timer || process.env.NEO3_KRABIK_WATCH === 'off') return;
  const once = () => {
    if (busy) return;
    busy = true;
    void watch.tick().catch(() => undefined).finally(() => {
      busy = false;
    });
  };
  once();
  timer = setInterval(once, CHECK_INTERVAL_MS);
  // Сторож не должен мешать процессу завершиться.
  timer.unref?.();
}

export function stopKrabikWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

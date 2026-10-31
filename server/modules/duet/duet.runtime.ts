/**
 * Боевые зависимости «Дуэта»: файл состояния, реестр, пуш и Telegram,
 * прогоны Claude через runHeadlessPrompt, сторож раз в минуту.
 * Логика — в duet.service.ts (там же тесты на фейках).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { projectsDb, providerPreferencesDb, pushSubscriptionsDb, telegramDb, userDb } from '@/modules/database/index.js';
import {
  buildNotificationPayload,
  createNotificationEvent,
  sendDesktopNotification,
  sendWebPushPayload,
} from '@/modules/notifications/index.js';
import { isBotConfigured, registerTelegramCallback, telegramApi } from '@/modules/telegram/index.js';
import { checkUsageGuard, formatResetMoscow } from '@/shared/claude-usage.js';
import { isModOn } from '@/shared/mods.js';

import { realExec, registryPath, type HeartbeatBot } from './duet-fleet.js';
import { createDuetService, type DuetNotice } from './duet.service.js';
import type { DuetDecision, DuetState } from './duet.types.js';

export const DUET_NOTICE_CODE = 'duet.notice';
export const DUET_CALLBACK_PREFIX = 'd:';
const TICK_MS = 60_000;

function duetDir(): string {
  return process.env.NEO3_DUET_DIR || path.join(os.homedir(), '.cloudcli', 'duet');
}

function statePath(): string {
  return path.join(duetDir(), 'state.json');
}

function antigravityRoot(): string {
  if (process.env.NEO3_DUET_PROJECT) return process.env.NEO3_DUET_PROJECT;
  const personal = path.join(os.homedir(), 'Antigravity Project');
  if (fs.existsSync(personal)) return personal;
  return process.env.WORKSPACES_ROOT || path.join(os.homedir(), 'workspace');
}

/** Активные админы: Дуэт есть только у владельца. */
function adminIds(): number[] {
  return userDb
    .listUsers()
    .filter((user: { role?: string; is_active?: number | string }) => user.role === 'admin' && Number(user.is_active) === 1)
    .map((user: { id: number | string }) => Number(user.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
}

export function duetOwnerId(): number | null {
  return adminIds()[0] ?? null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Markdown брифа → HTML Telegram: жирный, код, пункты. */
export function markdownToTelegram(text: string): string {
  return escapeHtml(text)
    .replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

const ICON: Record<DuetNotice['kind'], string> = {
  down: '🔴',
  up: '🟢',
  brief: '🎻',
  done: '✅',
  failed: '⚠️',
  ideas: '💡',
};

function telegramChatId(): string | null {
  try {
    const chatId = telegramDb.listBindings?.()?.[0]?.chat_id;
    return chatId && isBotConfigured() ? String(chatId) : null;
  } catch {
    return null;
  }
}

async function notify(notice: DuetNotice): Promise<{ chatId: string; messageId: number } | null> {
  if (notice.push) {
    const event = createNotificationEvent({
      provider: 'system',
      kind: 'info',
      code: DUET_NOTICE_CODE,
      meta: { title: notice.title, body: notice.body.slice(0, 400), kind: notice.kind },
      severity: notice.kind === 'down' || notice.kind === 'failed' ? 'warning' : 'info',
    });
    const payload = buildNotificationPayload(event);
    for (const userId of adminIds()) {
      if (pushSubscriptionsDb.getSubscriptions(userId).length > 0) {
        await sendWebPushPayload(userId, payload).catch(() => undefined);
      }
      try {
        sendDesktopNotification(userId, payload);
      } catch {
        // Настольное приложение может быть закрыто.
      }
    }
  }
  if (!notice.telegram) return null;
  const chatId = telegramChatId();
  if (!chatId) return null;
  const html = `${ICON[notice.kind]} <b>${escapeHtml(notice.title)}</b>\n${markdownToTelegram(notice.body)}`.slice(0, 3800);
  const buttons = notice.buttons ?? [];
  const replyMarkup = buttons.length > 0
    ? {
      inline_keyboard: [
        buttons.slice(0, 2).map((button) => ({ text: button.label, callback_data: `${DUET_CALLBACK_PREFIX}${button.token}` })),
        [
          ...buttons.slice(2).map((button) => ({ text: button.label, callback_data: `${DUET_CALLBACK_PREFIX}${button.token}` })),
        ],
      ].filter((row) => row.length > 0),
    }
    : null;
  try {
    const sent = await telegramApi.sendMessage(chatId, html, { replyMarkup });
    return { chatId, messageId: Number(sent?.message_id) };
  } catch {
    return null;
  }
}

const STATUS_LINE: Record<string, string> = {
  running: '⏳',
  done: '✅',
  failed: '⚠️',
  skipped: '➖',
  expired: '⌛',
};

async function closeTelegram(decision: DuetDecision): Promise<void> {
  if (!decision.telegram) return;
  const chosen = decision.chosen ? decision.options.find((option) => option.choice === decision.chosen)?.label : null;
  const html = [
    `<b>${escapeHtml(decision.title)}</b>`,
    escapeHtml(decision.body),
    '',
    `${STATUS_LINE[decision.status] ?? ''} ${chosen ? `${escapeHtml(chosen)} — ` : ''}${escapeHtml(decision.result ?? '')}`.trim(),
  ].join('\n').slice(0, 3800);
  await telegramApi.editMessageText(decision.telegram.chatId, decision.telegram.messageId, html, { replyMarkup: null }).catch(() => undefined);
}

async function heartbeats(): Promise<HeartbeatBot[]> {
  // Лениво: модуль «Сервер» читает файлы ботов, при старте он не нужен.
  const vps = await import('@/modules/vps/index.js');
  return vps.getBotsHealth().bots;
}

/** Папки проектов: корень Antigravity и его прямые подпапки, которые есть на диске. */
function projects(): string[] {
  const root = antigravityRoot();
  return projectsDb
    .getProjectPaths()
    .map((row: { project_path: string }) => row.project_path)
    .filter((projectPath: string) => projectPath === root || path.dirname(projectPath) === root)
    .filter((projectPath: string) => fs.existsSync(projectPath))
    .sort((a: string, b: string) => a.localeCompare(b, 'ru'));
}

export function duetProvider(): 'claude' | 'codex' {
  const explicit = process.env.NEO3_DUET_PROVIDER;
  if (explicit === 'claude' || explicit === 'codex') return explicit;
  const owner = duetOwnerId();
  const preferred = owner ? providerPreferencesDb.getProviderPreferences(owner).defaultProvider : null;
  return preferred === 'claude' ? 'claude' : 'codex';
}

async function runAgent(run: { projectPath: string; prompt: string; readOnly: boolean }) {
  const owner = duetOwnerId();
  if (!owner) throw new Error('Нет администратора — Дуэту не от чьего имени работать');
  const { runHeadlessPrompt } = await import('@/modules/agent-run/index.js');
  const result = await runHeadlessPrompt({
    projectPath: run.projectPath,
    prompt: run.prompt,
    userId: owner,
    provider: duetProvider(),
    actor: 'duet',
    readOnly: run.readOnly,
  });
  return { text: String(result.text ?? ''), sessionId: result.sessionId ?? null };
}

async function usageBlocked(): Promise<string | null> {
  if (duetProvider() !== 'claude') return null;
  const guard = await checkUsageGuard();
  if (!guard.blocked) return null;
  return `лимит подписки ${guard.pct === null ? '' : `${Math.round(guard.pct)}% `}— сброс в ${formatResetMoscow(guard.resetsAt)}`;
}

async function load(): Promise<DuetState | null> {
  try {
    return JSON.parse(await fsp.readFile(statePath(), 'utf8')) as DuetState;
  } catch {
    return null;
  }
}

async function save(state: DuetState): Promise<void> {
  await fsp.mkdir(duetDir(), { recursive: true });
  const tmp = `${statePath()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 1));
  await fsp.rename(tmp, statePath());
}

export const duetService = createDuetService({
  load,
  save,
  readRegistry: () => fsp.readFile(registryPath(), 'utf8'),
  exec: realExec,
  heartbeats,
  runAgent,
  usageBlocked,
  notify,
  closeTelegram,
  projects,
  homeProject: () => {
    const root = antigravityRoot();
    const registered = projectsDb.getProjectPaths().map((row: { project_path: string }) => row.project_path).filter((dir: string) => fs.existsSync(dir));
    return registered.includes(root) ? root : registered[0] || root;
  },
});

const REFUSAL: Record<string, string> = {
  not_found: 'Это решение уже не найти',
  already_decided: 'Уже решено',
  bad_choice: 'Так нельзя',
};

let timer: NodeJS.Timeout | null = null;
let busy = false;

function duetOn(): boolean {
  const owner = duetOwnerId();
  return owner !== null && isModOn(owner, 'modDuet');
}

export function startDuetWatch(): void {
  // Кнопки в Telegram работают, даже если сторож выключен переменной.
  registerTelegramCallback(DUET_CALLBACK_PREFIX, async (press) => {
    if (!duetOn() || !adminIds().includes(Number(press.binding.user_id))) {
      await press.reply('Дуэт выключен');
      return;
    }
    const result = await duetService.redeem(press.data.slice(DUET_CALLBACK_PREFIX.length));
    if (result.ok) {
      await press.reply(`Принято: ${result.label ?? ''}`.trim());
    } else {
      await press.reply(REFUSAL[result.reason] ?? 'Не получилось');
      await press.clearButtons();
    }
  });

  if (timer || process.env.NEO3_DUET_WATCH === 'off') return;
  const once = () => {
    if (busy || !duetOn()) return;
    busy = true;
    void duetService.tick().catch(() => undefined).finally(() => {
      busy = false;
    });
  };
  // Первый проход — после того, как сервер поднялся (ssh не тормозит старт).
  setTimeout(once, 30_000).unref?.();
  timer = setInterval(once, TICK_MS);
  timer.unref?.();
}

export function stopDuetWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Telegram bot brain: turns an incoming Update into either a polite refusal or
// an agent run inside a project the *bound* user is allowed to touch.
//
// Access rule, and the reason this module exists: a chat gets nothing until a
// row in telegram_bindings ties it to an app user. Anyone can find the bot in
// Telegram, so an unbound chat must never learn project names, commands or
// anything else about the installation.

import path from 'node:path';
import { randomInt } from 'node:crypto';

import { projectsDb, userDb, userProjectAccessDb } from '@/modules/database/index.js';
import { telegramDb, type TelegramBindingRow } from '@/modules/database/repositories/telegram.db.js';
import { telegramApi } from '@/modules/telegram/telegram-api.client.js';

export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const LINK_CODE_TTL_SECONDS = 600;

const TYPING_INTERVAL_MS = 4_000;
// No I/O/0/1 — codes get read aloud and retyped on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

const NOT_LINKED_MESSAGE = [
  'Этот чат не привязан к Neo3 Agent System.',
  '',
  'Если у вас есть доступ к системе: откройте настройки Telegram в Neo3, нажмите «Привязать Telegram»',
  'и отправьте сюда команду /start с полученным кодом.',
].join('\n');

const HELP_MESSAGE = [
  'Команды Neo3 Agent System:',
  '',
  '/project — список доступных проектов и выбор рабочего проекта',
  '/new — начать новую сессию (забыть предыдущий диалог)',
  '/help — эта справка',
  '',
  'Любое обычное сообщение уходит агенту в выбранный проект.',
].join('\n');

export type ProjectChoice = {
  path: string;
  name: string;
};

type PromptRunner = (options: {
  projectPath: string;
  prompt: string;
  userId: number;
  sessionId?: string;
}) => Promise<{ sessionId: string | null; text: string; messages: unknown[] }>;

type ChatRunState = {
  sessionId: string | null;
  busy: boolean;
};

// Session continuity lives in memory: a restart starts a fresh conversation,
// which is the same thing /new does on purpose.
const chatStates = new Map<string, ChatRunState>();

// Test seam. The engine dispatch is the only branch a test cannot exercise —
// it would spawn a real CLI — so it stays swappable.
let promptRunner: PromptRunner | null = null;

export function setPromptRunnerForTests(runner: PromptRunner | null): void {
  promptRunner = runner;
}

/**
 * Loaded on demand, not at module load: importing the agent-run service drags
 * in every engine module, and answering "this chat is not linked" should not
 * cost that.
 */
async function loadAgentRun() {
  return import('@/modules/agent-run/agent-run.service.js');
}

// --- text helpers -----------------------------------------------------------

/** Escapes the characters Telegram's HTML parse mode would otherwise read as markup. */
export function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapedLength(text: string): number {
  return escapeHtml(text).length;
}

/** Splits one long line whose escaped form does not fit into a single message. */
function hardSplit(line: string, limit: number): string[] {
  if (escapedLength(line) <= limit) {
    return [line];
  }

  const pieces: string[] = [];
  let current = '';
  let currentLength = 0;

  for (const char of line) {
    const charLength = escapedLength(char);
    if (currentLength + charLength > limit) {
      pieces.push(current);
      current = char;
      currentLength = charLength;
    } else {
      current += char;
      currentLength += charLength;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

/**
 * Cuts plain text into pieces that still fit Telegram's limit *after* escaping.
 *
 * Measuring the escaped length here (instead of splitting escaped text) is what
 * guarantees no chunk ends in the middle of an `&amp;` entity.
 */
export function splitForTelegram(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
  const source = String(text ?? '');
  if (!source) return [];

  const chunks: string[] = [];
  let current = '';
  let currentLength = 0;

  source.split('\n').forEach((line, lineIndex) => {
    hardSplit(line, limit).forEach((piece, pieceIndex) => {
      const pieceLength = escapedLength(piece);
      // A newline is re-inserted only where the source had one — pieces of a
      // single over-long line must be glued back without any added character.
      const separator = lineIndex > 0 && pieceIndex === 0 ? '\n' : '';

      if (!current) {
        current = piece;
        currentLength = pieceLength;
        return;
      }

      const needed = separator.length + pieceLength;
      if (currentLength + needed > limit) {
        chunks.push(current);
        current = piece;
        currentLength = pieceLength;
        return;
      }

      current += separator + piece;
      currentLength += needed;
    });
  });

  if (current) chunks.push(current);
  return chunks;
}

/** Sends plain text: escaped and split into as many messages as the limit requires. */
async function sendPlain(chatId: string, text: string): Promise<void> {
  const chunks = splitForTelegram(text);
  for (const chunk of chunks) {
    await telegramApi.sendMessage(chatId, escapeHtml(chunk));
  }
}

// --- link codes -------------------------------------------------------------

export function generateLinkCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Issues a fresh code and invalidates the user's previous ones. */
export function issueLinkCode(userId: number): { code: string; expiresInSeconds: number } {
  telegramDb.deleteExpiredLinkCodes();
  telegramDb.deleteUserLinkCodes(userId);
  const code = generateLinkCode();
  telegramDb.createLinkCode(userId, code, LINK_CODE_TTL_SECONDS);
  return { code, expiresInSeconds: LINK_CODE_TTL_SECONDS };
}

// --- projects ---------------------------------------------------------------

/** Projects the bound user may run in — the same fail-closed rule the web UI uses. */
export function listAccessibleProjects(userId: number): ProjectChoice[] {
  const user = userDb.getUserById(Number(userId));
  if (!user) return [];

  const projects = projectsDb.getProjectPaths();
  const visible = user.role === 'admin'
    ? projects
    : (() => {
        const accessible = new Set(userProjectAccessDb.getAccessibleProjectIds(user.id));
        return projects.filter((project) => accessible.has(project.project_id));
      })();

  return visible.map((project) => ({
    path: project.project_path,
    name: project.custom_project_name || path.basename(project.project_path) || project.project_path,
  }));
}

function resolveProjectChoice(choices: ProjectChoice[], selector: string): ProjectChoice | null {
  const normalized = selector.trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized) - 1;
    return choices[index] ?? null;
  }

  const lowered = normalized.toLowerCase();
  const exact = choices.find(
    (choice) => choice.path.toLowerCase() === lowered || choice.name.toLowerCase() === lowered
  );
  if (exact) return exact;

  const matches = choices.filter(
    (choice) => choice.name.toLowerCase().includes(lowered) || choice.path.toLowerCase().includes(lowered)
  );
  return matches.length === 1 ? matches[0] : null;
}

function formatProjectList(choices: ProjectChoice[]): string {
  const lines = choices.map((choice, index) => `${index + 1}. ${choice.name} — ${choice.path}`);
  return [
    'Доступные проекты:',
    '',
    ...lines,
    '',
    'Выбрать: /project <номер> (например /project 1)',
  ].join('\n');
}

// --- chat state -------------------------------------------------------------

function getChatState(chatId: string): ChatRunState {
  let state = chatStates.get(chatId);
  if (!state) {
    state = { sessionId: null, busy: false };
    chatStates.set(chatId, state);
  }
  return state;
}

export function resetChatSession(chatId: string): void {
  chatStates.delete(chatId);
}

// --- update handling --------------------------------------------------------

type ParsedCommand = {
  name: string;
  args: string;
};

function parseCommand(text: string): ParsedCommand | null {
  if (!text.startsWith('/')) return null;

  const [head, ...rest] = text.slice(1).split(/\s+/);
  // Group chats deliver commands as "/start@Neo3Bot".
  const name = head.split('@')[0].toLowerCase();
  if (!name) return null;

  return { name, args: rest.join(' ').trim() };
}

/**
 * A binding only counts while it is enabled *and* its user still exists — a
 * deleted or disabled account must not keep a live door open through Telegram.
 */
function getActiveBinding(chatId: string): TelegramBindingRow | null {
  const binding = telegramDb.getBindingByChatId(chatId);
  if (!binding || !binding.enabled) return null;
  if (!userDb.getUserById(Number(binding.user_id))) return null;
  return binding;
}

function startTypingHeartbeat(chatId: string): () => void {
  const ping = () => {
    telegramApi.sendChatAction(chatId, 'typing').catch(() => {
      // Purely cosmetic — a failed "typing" must not disturb the run.
    });
  };

  ping();
  const timer = setInterval(ping, TYPING_INTERVAL_MS);
  timer.unref?.();

  return () => clearInterval(timer);
}

async function handleStart(
  chatId: string,
  telegramUsername: string | null,
  binding: TelegramBindingRow | null,
  code: string
): Promise<void> {
  if (code) {
    const linkCode = telegramDb.consumeLinkCode(code);
    if (!linkCode) {
      await sendPlain(chatId, 'Код не подошёл: он неверный, уже использован или истёк. Выпустите новый в Neo3.');
      return;
    }

    const user = userDb.getUserById(Number(linkCode.user_id));
    if (!user) {
      await sendPlain(chatId, 'Код не подошёл: пользователь больше не существует.');
      return;
    }

    telegramDb.upsertBinding({ userId: user.id, chatId, telegramUsername });
    resetChatSession(chatId);

    const choices = listAccessibleProjects(user.id);
    const tail = choices.length
      ? `\n\n${formatProjectList(choices)}`
      : '\n\nДоступных проектов пока нет — попросите администратора выдать доступ.';
    await sendPlain(chatId, `Готово. Чат привязан к пользователю ${user.username}.${tail}`);
    return;
  }

  if (!binding) {
    await sendPlain(chatId, NOT_LINKED_MESSAGE);
    return;
  }

  await sendPlain(chatId, `Neo3 Agent System на связи.\n\n${HELP_MESSAGE}`);
}

async function handleProject(chatId: string, binding: TelegramBindingRow, selector: string): Promise<void> {
  const choices = listAccessibleProjects(binding.user_id);
  if (choices.length === 0) {
    await sendPlain(chatId, 'Доступных проектов нет. Попросите администратора выдать доступ в Neo3.');
    return;
  }

  if (!selector) {
    const current = binding.project_path ? `\n\nТекущий проект: ${binding.project_path}` : '';
    await sendPlain(chatId, `${formatProjectList(choices)}${current}`);
    return;
  }

  const choice = resolveProjectChoice(choices, selector);
  if (!choice) {
    await sendPlain(chatId, `Не нашёл такой проект среди доступных.\n\n${formatProjectList(choices)}`);
    return;
  }

  telegramDb.setBindingProjectPath(binding.user_id, chatId, choice.path);
  // A different project means a different working directory — the old session
  // would keep answering about the previous one.
  resetChatSession(chatId);
  await sendPlain(chatId, `Проект выбран: ${choice.name}\n${choice.path}\n\nСессия начата заново.`);
}

async function handlePrompt(chatId: string, binding: TelegramBindingRow, prompt: string): Promise<void> {
  const state = getChatState(chatId);
  if (state.busy) {
    await sendPlain(chatId, 'Ещё работаю над предыдущим сообщением. Дождитесь ответа или сбросьте: /new');
    return;
  }

  if (!binding.project_path) {
    await sendPlain(chatId, 'Проект не выбран. Выберите его командой /project');
    return;
  }

  const { checkProjectAccess, runHeadlessPrompt } = await loadAgentRun();
  const access = checkProjectAccess(binding.user_id, binding.project_path);
  if (!access.ok) {
    await sendPlain(chatId, `Нет доступа к проекту: ${access.error}\n\nВыберите другой: /project`);
    return;
  }

  state.busy = true;
  const stopTyping = startTypingHeartbeat(chatId);

  try {
    const runner = promptRunner || runHeadlessPrompt;
    const result = await runner({
      projectPath: access.projectPath,
      prompt,
      userId: binding.user_id,
      sessionId: state.sessionId ?? undefined,
    });

    if (result?.sessionId) {
      state.sessionId = result.sessionId;
    }

    const answer = (result?.text || '').trim();
    await sendPlain(chatId, answer || 'Агент завершил работу, но ничего не написал в ответ.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendPlain(chatId, `Прогон не удался: ${message}`);
  } finally {
    stopTyping();
    state.busy = false;
  }
}

/**
 * Entry point for one Telegram Update. Never throws: the webhook has already
 * answered 200 by the time this runs, so failures are logged, not propagated.
 */
export async function handleTelegramUpdate(update: unknown): Promise<void> {
  const message = (update as { message?: Record<string, any> } | null)?.message;
  if (!message || typeof message !== 'object') return;

  const chatId = message.chat?.id === undefined || message.chat?.id === null ? '' : String(message.chat.id);
  if (!chatId) return;

  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const telegramUsername = typeof message.from?.username === 'string' ? message.from.username : null;

  const binding = getActiveBinding(chatId);
  const command = parseCommand(text);

  try {
    // /start is the only thing an unbound chat may run, because it carries the code.
    if (command?.name === 'start') {
      await handleStart(chatId, telegramUsername, binding, command.args);
      return;
    }

    if (!binding) {
      await sendPlain(chatId, NOT_LINKED_MESSAGE);
      return;
    }

    if (command) {
      if (command.name === 'help') {
        await sendPlain(chatId, HELP_MESSAGE);
        return;
      }
      if (command.name === 'project') {
        await handleProject(chatId, binding, command.args);
        return;
      }
      if (command.name === 'new') {
        // Also clears a stuck "busy" flag — this is the user's escape hatch when
        // a previous run died without answering.
        resetChatSession(chatId);
        await sendPlain(chatId, 'Начал новую сессию. Прошлый диалог забыт.');
        return;
      }

      await sendPlain(chatId, `Не знаю команду /${command.name}.\n\n${HELP_MESSAGE}`);
      return;
    }

    if (!text) {
      await sendPlain(chatId, 'Пока понимаю только текст. Пришлите сообщение словами.');
      return;
    }

    await handlePrompt(chatId, binding, text);
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    console.error('Telegram update handling failed:', description);
  }
}

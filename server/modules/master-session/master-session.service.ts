/**
 * Мастер-сессия: все ждущие вопросы чатов, доступных пользователю, и ответы
 * на них пачкой (истории 31–33).
 *
 *   listQuestions()  ждущие сессии из реестра статусов (правило доступа —
 *                    `projectAccessFor` внутри `sessionAttention.listForUser`)
 *   prepareDrafts()  черновики ответов от модели (прогон «только чтение»)
 *   send()           доставка: структурный вопрос (вопрос / план / разрешение
 *                    с открытым запросом) — `pendingAnswers.answer()`, остальное —
 *                    обычное сообщение в чат; чат изменился → `stale`;
 *                    повтор того же `batchId` ничего не доставляет второй раз
 *
 * Все зависимости — через фабрику: сервис не знает ни шлюза чата, ни модели.
 */

import { pickAnswerChoices } from '@/modules/notifications/index.js';
import type { AnswerDecision } from '@/modules/pending-answers/index.js';
import type { AttentionItem, AttentionReason, AttentionUser } from '@/modules/session-attention/index.js';
import { isModOn as defaultIsModOn, modOffError, type IsModOn } from '@/shared/mods.js';
import { AppError } from '@/shared/utils.js';

import type { MasterSendLedger } from './master-session.ledger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MasterQuestionChoice = { id: string; label: string };

export type MasterQuestion = {
  sessionId: string;
  projectId: string;
  projectName: string;
  provider: string;
  title: string | null;
  reason: AttentionReason;
  /** Состояние чата, к которому относится ответ (`expectedUpdatedAt` при отправке). */
  updatedAt: string;
  /** Текст вопроса одной строкой (вопрос, заголовок плана, инструмент, последний абзац ответа). */
  question: string;
  /** Последний абзац ответа агента или текст плана, ≤1500 символов. */
  excerpt: string | null;
  /** `choice` — у вопроса есть кнопки; `text` — ответ только текстом. */
  mode: 'choice' | 'text';
  choices: MasterQuestionChoice[];
};

export type MasterAnswer = { choice?: string; text?: string };

export type MasterSendItem = { sessionId: string; expectedUpdatedAt: string; answer: MasterAnswer };

export type MasterSendStatus = 'sent' | 'stale' | 'failed';

/**
 * `stale` — чат уже не ждёт этого ответа; `failed`: `forbidden` (нет доступа),
 * `bad_answer` (нет ни варианта, ни текста / чужой вариант), `not_pending`,
 * `unavailable`, `in_progress` (ответы pending-answers), `not_started`
 * (сообщение не ушло: в чате идёт прогон, движок недоступен).
 */
export type MasterSendResult = { sessionId: string; status: MasterSendStatus; reason?: string };

export type MasterDraft = { sessionId: string; text: string; choice?: string; updatedAt: string };

export type MasterAnswerInput = {
  requestId: string;
  decision: AnswerDecision;
  actorUserId: number | string | null;
  actorRole?: string | null;
  via: 'ui';
};

export type MasterSessionDependencies = {
  /** Реестр статусов «Ждут тебя»: только сессии, видимые пользователю. */
  attention: { listForUser(user: AttentionUser): AttentionItem[] };
  /** Ответ на открытый запрос (вопрос, план, разрешение) любым движком. */
  pendingAnswers: {
    answer(input: MasterAnswerInput): Promise<{ ok: true } | { ok: false; reason: string }>;
  };
  /** Обычное сообщение пользователя в чат. true — прогон зарегистрирован и начат. */
  send: (input: { sessionId: string; userId: number; content: string }) => boolean | Promise<boolean>;
  /** Один прогон модели «только чтение» в папке проекта; возвращает её текст. */
  drafts: (input: { userId: number; projectPath: string; prompt: string }) => Promise<string>;
  /** Папка проекта сессии (там идёт прогон черновиков); null — неизвестно. */
  sessionProjectPath: (sessionId: string) => string | null;
  isModOn?: IsModOn;
  now?: () => number;
  /** Итоги доставок, переживающие рестарт (`createWorkspaceMasterSendLedger`); нет — только память процесса. */
  ledger?: MasterSendLedger;
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const MOD_KEY = 'modSessionHub' as const;
/** Сколько вариантов показывать на вопрос (как у Telegram). */
const MAX_CHOICES = 8;
const MAX_ITEMS = 50;
const MAX_TEXT = 8000;
const EXCERPT_MAX = 1500;
const QUESTION_MAX = 400;
const BATCH_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;
/** Сколько помнить отправленные пачки: повтор позже суток уже не «то же нажатие». */
const BATCH_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REMEMBERED = 2000;
const STRUCTURED_REASONS: ReadonlySet<string> = new Set(['ask', 'plan', 'permission']);

const DRAFTS_FAILED_MESSAGE = 'Не удалось подготовить черновики: модель не ответила. Ответь вручную — черновики не обязательны.';

function userIdOf(user: AttentionUser): number {
  const id = Number(user.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError('Нужна авторизация', { code: 'UNAUTHORIZED', statusCode: 401 });
  }
  return id;
}

function oneLine(text: string | undefined | null, max: number): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function clip(text: string | undefined | null, max: number): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/** Открытый запрос, на который отвечают через pending-answers. */
function isStructured(entry: AttentionItem): boolean {
  return Boolean(entry.detail?.requestId) && STRUCTURED_REASONS.has(String(entry.reason));
}

function toQuestion(entry: AttentionItem): MasterQuestion {
  const choices = isStructured(entry)
    ? pickAnswerChoices(entry, MAX_CHOICES).map(({ id, label }) => ({ id, label }))
    : [];
  return {
    sessionId: entry.sessionId,
    projectId: entry.projectId,
    projectName: entry.projectName,
    provider: entry.provider,
    title: entry.title,
    reason: entry.reason,
    updatedAt: entry.updatedAt,
    question: oneLine(entry.detail?.question || entry.detail?.excerpt, QUESTION_MAX),
    excerpt: clip(entry.detail?.excerpt, EXCERPT_MAX),
    mode: choices.length > 0 ? 'choice' : 'text',
    choices,
  };
}

/**
 * Текст на структурный вопрос: для вопроса — ответ на каждый его пункт
 * (тот же текст), для плана и разрешения — «нет, вот что сделать».
 */
function textDecision(entry: AttentionItem, text: string): AnswerDecision {
  if (entry.reason === 'ask') {
    const questions = entry.detail?.questions?.map((question) => question.question).filter(Boolean)
      ?? (entry.detail?.question ? [entry.detail.question] : []);
    if (questions.length > 0) {
      return { allow: true, answers: Object.fromEntries(questions.map((question) => [question, text])) };
    }
  }
  return { allow: false, message: text };
}

function readText(answer: MasterAnswer | undefined): string {
  return typeof answer?.text === 'string' ? answer.text.trim().slice(0, MAX_TEXT) : '';
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

function draftPrompt(questions: MasterQuestion[]): string {
  const blocks = questions.map((question, index) => {
    const lines = [
      `### ${index + 1}. sessionId: ${question.sessionId}`,
      `Проект: ${question.projectName || question.projectId} · чат: ${question.title ?? 'без названия'} · движок: ${question.provider}`,
      `Вопрос: ${question.question || '(без текста)'}`,
    ];
    if (question.excerpt && question.excerpt !== question.question) {
      lines.push(`Последнее сообщение агента:\n${question.excerpt}`);
    }
    if (question.choices.length > 0) {
      lines.push(`Варианты (choice → подпись): ${question.choices.map((choice) => `${choice.id} → ${choice.label}`).join('; ')}`);
    }
    return lines.join('\n');
  });
  return [
    'Ты помогаешь пользователю ответить на вопросы его агентов в нескольких чатах сразу.',
    'Для каждого вопроса предложи короткий черновик ответа от лица пользователя, по-русски.',
    'Если у вопроса есть варианты и один из них подходит — укажи его id в поле "choice", "text" оставь пустым.',
    'Не выдумывай факты о пользователе (цены, адреса, ключи, пароли): вместо них пиши заглушку вида [ВПИШИ: что именно].',
    'Ничего не делай в проекте: только ответь. Ответ — один JSON без пояснений:',
    '{"drafts":[{"sessionId":"…","text":"…","choice":"…"}]}',
    '',
    ...blocks,
  ].join('\n');
}

function parseDrafts(raw: string): Array<{ sessionId: string; text: string; choice?: string }> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (parsed as { drafts?: unknown } | null)?.drafts;
  if (!Array.isArray(list)) return null;
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.sessionId !== 'string') return [];
    return [{
      sessionId: record.sessionId,
      text: typeof record.text === 'string' ? record.text.trim().slice(0, MAX_TEXT) : '',
      ...(typeof record.choice === 'string' && record.choice ? { choice: record.choice } : {}),
    }];
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createMasterSessionService(dependencies: MasterSessionDependencies) {
  const isModOn = dependencies.isModOn ?? defaultIsModOn;
  const now = dependencies.now ?? (() => Date.now());
  /** `user:batch:session` → итог первой доставки (или её обещание, пока идёт). */
  const delivered = new Map<string, { at: number; result: Promise<MasterSendResult> }>();

  function requireMod(userId: number): void {
    if (!isModOn(userId, MOD_KEY)) {
      throw modOffError(MOD_KEY);
    }
  }

  function waitingFor(user: AttentionUser): AttentionItem[] {
    return dependencies.attention.listForUser(user).filter((entry) => entry.state === 'waiting');
  }

  const ledger = dependencies.ledger ?? null;

  function prune(): void {
    ledger?.prune(now());
    const cutoff = now() - BATCH_TTL_MS;
    for (const [key, entry] of delivered) {
      if (entry.at < cutoff || delivered.size > MAX_REMEMBERED) delivered.delete(key);
      else break;
    }
  }

  function readLedger(key: string): MasterSendResult | null {
    try {
      return ledger?.get(key) ?? null;
    } catch (error) {
      console.error('[MasterSession] send ledger not read', { error: (error as Error)?.message });
      return null;
    }
  }

  function writeLedger(key: string, result: MasterSendResult, at: number): void {
    try {
      ledger?.put(key, result, at);
    } catch (error) {
      // Память процесса остаётся; после рестарта повтор доставит ещё раз.
      console.error('[MasterSession] send ledger not written', { error: (error as Error)?.message });
    }
  }

  async function deliverOne(user: AttentionUser, userId: number, item: MasterSendItem): Promise<MasterSendResult> {
    const { sessionId } = item;
    // Доступ — тем же списком, что и показ: чужую сессию не видно, значит и не ответить.
    const visible = dependencies.attention.listForUser(user).find((entry) => entry.sessionId === sessionId);
    if (!visible) {
      return { sessionId, status: 'failed', reason: 'forbidden' };
    }
    if (visible.state !== 'waiting' || visible.updatedAt !== item.expectedUpdatedAt) {
      return { sessionId, status: 'stale' };
    }

    const text = readText(item.answer);
    const choiceId = typeof item.answer?.choice === 'string' ? item.answer.choice : '';

    if (isStructured(visible)) {
      let decision: AnswerDecision | null = null;
      if (choiceId) {
        decision = pickAnswerChoices(visible, MAX_CHOICES).find((choice) => choice.id === choiceId)?.decision ?? null;
      } else if (text) {
        decision = textDecision(visible, text);
      }
      if (!decision) {
        return { sessionId, status: 'failed', reason: 'bad_answer' };
      }
      const answered = await dependencies.pendingAnswers.answer({
        requestId: String(visible.detail?.requestId),
        decision,
        actorUserId: userId,
        actorRole: user.role ?? null,
        via: 'ui',
      });
      return answered.ok ? { sessionId, status: 'sent' } : { sessionId, status: 'failed', reason: answered.reason };
    }

    if (!text || choiceId) {
      return { sessionId, status: 'failed', reason: 'bad_answer' };
    }
    let started = false;
    try {
      started = await dependencies.send({ sessionId, userId, content: text });
    } catch (error) {
      console.error('[MasterSession] message was not sent', { sessionId, error: (error as Error)?.message });
    }
    return started ? { sessionId, status: 'sent' } : { sessionId, status: 'failed', reason: 'not_started' };
  }

  return {
    /** Ждущие вопросы всех доступных пользователю чатов, свежие сверху. */
    listQuestions(user: AttentionUser): MasterQuestion[] {
      requireMod(userIdOf(user));
      return waitingFor(user).map(toQuestion);
    },

    /** Черновики для выбранных ждущих вопросов. Модель только читает; сбой — понятная ошибка. */
    async prepareDrafts(user: AttentionUser, input: { sessionIds: unknown }): Promise<{ drafts: MasterDraft[] }> {
      const userId = userIdOf(user);
      requireMod(userId);
      const wanted = new Set(Array.isArray(input.sessionIds)
        ? input.sessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []);
      const questions = waitingFor(user).map(toQuestion).filter((question) => wanted.has(question.sessionId)).slice(0, MAX_ITEMS);
      if (questions.length === 0) {
        throw new AppError('Нет ждущих вопросов для черновиков', { code: 'NO_QUESTIONS', statusCode: 400 });
      }
      const projectPath = questions.map((question) => dependencies.sessionProjectPath(question.sessionId)).find(Boolean);
      if (!projectPath) {
        throw new AppError(DRAFTS_FAILED_MESSAGE, { code: 'DRAFTS_FAILED', statusCode: 502 });
      }

      let raw: string;
      try {
        raw = await dependencies.drafts({ userId, projectPath, prompt: draftPrompt(questions) });
      } catch (error) {
        console.error('[MasterSession] drafts failed', { error: (error as Error)?.message });
        throw new AppError(DRAFTS_FAILED_MESSAGE, { code: 'DRAFTS_FAILED', statusCode: 502 });
      }
      const parsed = parseDrafts(String(raw ?? ''));
      if (!parsed) {
        throw new AppError(DRAFTS_FAILED_MESSAGE, { code: 'DRAFTS_FAILED', statusCode: 502 });
      }

      const bySession = new Map(parsed.map((draft) => [draft.sessionId, draft] as const));
      const drafts = questions.flatMap((question): MasterDraft[] => {
        const draft = bySession.get(question.sessionId);
        if (!draft) return [];
        const choice = draft.choice && question.choices.some((entry) => entry.id === draft.choice) ? draft.choice : undefined;
        return [{ sessionId: question.sessionId, text: draft.text, ...(choice ? { choice } : {}), updatedAt: question.updatedAt }];
      });
      return { drafts };
    },

    /** «Отправить всё»: каждый пункт отдельно; повтор того же batchId возвращает первый итог. */
    async send(user: AttentionUser, input: { batchId: unknown; items: unknown }): Promise<{ results: MasterSendResult[] }> {
      const userId = userIdOf(user);
      requireMod(userId);
      const batchId = typeof input.batchId === 'string' ? input.batchId : '';
      if (!BATCH_ID_RE.test(batchId)) {
        throw new AppError('Нужен batchId (8–100 символов: буквы, цифры, - и _)', { code: 'BAD_BATCH', statusCode: 400 });
      }
      if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > MAX_ITEMS) {
        throw new AppError(`Нужен список ответов (1–${MAX_ITEMS})`, { code: 'BAD_ITEMS', statusCode: 400 });
      }
      const items = input.items.filter((entry): entry is MasterSendItem => Boolean(entry)
        && typeof (entry as MasterSendItem).sessionId === 'string'
        && typeof (entry as MasterSendItem).expectedUpdatedAt === 'string');
      if (items.length !== input.items.length) {
        throw new AppError('У каждого ответа нужны sessionId и expectedUpdatedAt', { code: 'BAD_ITEMS', statusCode: 400 });
      }

      prune();
      const seen = new Set<string>();
      const results: MasterSendResult[] = [];
      // По одному: два ответа в один чат не должны обгонять друг друга.
      for (const item of items) {
        if (seen.has(item.sessionId)) continue;
        seen.add(item.sessionId);
        const key = `${userId}:${batchId}:${item.sessionId}`;
        let entry = delivered.get(key);
        if (!entry) {
          // Ушло до рестарта — вернуть тот итог, ничего не доставляя.
          const remembered = readLedger(key);
          if (remembered) {
            results.push(remembered);
            continue;
          }
          const at = now();
          entry = { at, result: deliverOne(user, userId, item) };
          delivered.set(key, entry);
          // Не дошло из-за сбоя — повтор того же нажатия может попробовать снова.
          void entry.result.then((result) => {
            if (result.status === 'failed' && result.reason !== 'forbidden') delivered.delete(key);
            else writeLedger(key, result, at);
          }, () => delivered.delete(key));
        }
        try {
          results.push(await entry.result);
        } catch (error) {
          console.error('[MasterSession] delivery failed', { sessionId: item.sessionId, error: (error as Error)?.message });
          results.push({ sessionId: item.sessionId, status: 'failed', reason: 'unavailable' });
        }
      }
      return { results };
    },
  };
}

export type MasterSessionService = ReturnType<typeof createMasterSessionService>;

/**
 * /advisor <question>: asks a stronger model (Claude Opus, read-only run) with
 * the last messages of the chat. One call per command, the answer goes to the
 * `advisor` canvas tab. The current session's model is never touched: the run
 * is its own headless run.
 */

import type { IsModOn } from '@/shared/mods.js';
import { AppError } from '@/shared/utils.js';

import type { ReplyTurnMessage } from '../../../shared/reply-turn.js';

export const ADVISOR_MODEL = 'opus';
const QUESTION_MAX = 4000;
const MESSAGES_MAX = 12;
const MESSAGE_CHARS_MAX = 1500;
const CONTEXT_CHARS_MAX = 12000;

export type AdvisorUser = { id?: number | string | null; role?: string | null } | null | undefined;

export type AdvisorDependencies = {
  isModOn: IsModOn;
  canAccessSession: (user: AdvisorUser, sessionId: string) => boolean;
  /** Folder the read-only run is rooted in; null when the session is unknown. */
  projectPathOf: (sessionId: string) => string | null;
  fetchMessages: (sessionId: string) => Promise<ReplyTurnMessage[]>;
  runAgent: (run: { projectPath: string; prompt: string; userId: number; model: string }) => Promise<{ text: string }>;
  /** Reason text when the subscription limit is reached, else null. */
  usageBlocked: () => Promise<string | null>;
};

export function buildAdvisorPrompt(question: string, messages: ReplyTurnMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.kind !== 'text' || typeof message.content !== 'string') continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = message.content.trim();
    if (!text) continue;
    const clipped = text.length > MESSAGE_CHARS_MAX ? `${text.slice(0, MESSAGE_CHARS_MAX)}…` : text;
    lines.push(`${message.role === 'user' ? 'Пользователь' : 'Агент'}: ${clipped}`);
  }
  let context = lines.slice(-MESSAGES_MAX).join('\n\n');
  if (context.length > CONTEXT_CHARS_MAX) context = context.slice(context.length - CONTEXT_CHARS_MAX);
  return [
    'Ты советник: независимая сильная модель, которую просят дать второе мнение по рабочему чату.',
    'Ты работаешь только на чтение, ничего не меняешь. Отвечай по-русски, коротко и по делу; если не хватает данных, так и скажи.',
    '',
    '<последние_сообщения_чата>',
    context || '(в чате пока нет сообщений)',
    '</последние_сообщения_чата>',
    '',
    `Вопрос: ${question}`,
  ].join('\n');
}

export function createAdvisor(deps: AdvisorDependencies) {
  const inFlight = new Set<string>();

  return {
    async ask(input: { user: AdvisorUser; sessionId: unknown; question: unknown }): Promise<{ answer: string }> {
      const userId = Number(input.user?.id);
      if (!deps.isModOn(userId, 'modDiagnostics')) {
        throw new AppError('Диагностика выключена в настройках.', { code: 'MOD_OFF', statusCode: 409 });
      }
      const question = typeof input.question === 'string' ? input.question.trim() : '';
      if (!question) {
        throw new AppError('Напиши вопрос после /advisor.', { code: 'ADVISOR_QUESTION_REQUIRED', statusCode: 400 });
      }
      if (question.length > QUESTION_MAX) {
        throw new AppError(`Вопрос длиннее ${QUESTION_MAX} символов.`, { code: 'ADVISOR_QUESTION_TOO_LONG', statusCode: 400 });
      }
      const sessionId = typeof input.sessionId === 'string' ? input.sessionId : '';
      const projectPath = sessionId ? deps.projectPathOf(sessionId) : null;
      if (!sessionId || !projectPath || !deps.canAccessSession(input.user, sessionId)) {
        throw new AppError('Чат не найден или нет доступа.', { code: 'ADVISOR_SESSION_NOT_FOUND', statusCode: 404 });
      }

      const key = `${userId}:${sessionId}`;
      if (inFlight.has(key)) {
        throw new AppError('Советник уже отвечает на прошлый вопрос.', { code: 'ADVISOR_BUSY', statusCode: 409 });
      }
      inFlight.add(key);
      try {
        const blocked = await deps.usageBlocked();
        if (blocked) {
          throw new AppError(`Советник не вызван: ${blocked}.`, { code: 'ADVISOR_LIMIT', statusCode: 429 });
        }
        let messages: ReplyTurnMessage[] = [];
        try {
          messages = await deps.fetchMessages(sessionId);
        } catch {
          // Without history the question still goes out, just without context.
        }
        let text: string;
        try {
          const result = await deps.runAgent({
            projectPath,
            prompt: buildAdvisorPrompt(question, messages),
            userId,
            model: ADVISOR_MODEL,
          });
          text = String(result.text ?? '').trim();
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 160) : 'неизвестная ошибка';
          throw new AppError(`Советник не ответил: ${reason}`, { code: 'ADVISOR_FAILED', statusCode: 502 });
        }
        if (!text) {
          throw new AppError('Советник вернул пустой ответ. Попробуй ещё раз позже.', { code: 'ADVISOR_FAILED', statusCode: 502 });
        }
        return { answer: text };
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

export type AdvisorService = ReturnType<typeof createAdvisor>;

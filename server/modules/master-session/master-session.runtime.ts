import { lastRunOptions } from '@/modules/auto-relay/index.js';
import { sessionsDb } from '@/modules/database/index.js';
import { pendingAnswers } from '@/modules/pending-answers/index.js';
import { sessionAttention } from '@/modules/session-attention/index.js';
import type { ThreadRunControl } from '@/modules/threads/index.js';

import { createMasterSessionService, type MasterSessionService } from './master-session.service.js';

/**
 * Боевые зависимости мастер-сессии: реестр статусов, pending-answers, шлюз
 * чата для текстовых ответов, Claude «только чтение» для черновиков.
 *
 * Шлюз чата. Обычное сообщение в чат сервер шлёт через `beginChatSend`
 * (реестр прогонов, индикатор, «Стоп», «Ждут тебя») — его отдаёт только
 * run-control, который `server/index.js` собирает из `chatDependencies`.
 * index.js передаёт сюда run-control тредов явно:
 * `setMasterSessionRunControl(createThreadRunControl(chatDependencies))`.
 * Прогон идёт с доступом `thread` на сам чат (`parentSessionId === sessionId`):
 * шлюз проверяет только `canAccessSession` пользователя — то же правило, что у
 * набранного сообщения.
 */
let runControl: ThreadRunControl | null = null;

export function setMasterSessionRunControl(control: ThreadRunControl): void {
  runControl = control;
}

/** Настройки движка, как у набранного сообщения: последний прогон человека, иначе модель/effort чата. */
function runOptionsFor(sessionId: string): Record<string, unknown> {
  const last = lastRunOptions(sessionId);
  if (last) return last;
  const session = sessionsDb.getSessionById(sessionId) as { model?: string | null; effort?: string | null } | null | undefined;
  return {
    ...(session?.model ? { model: session.model } : {}),
    ...(session?.effort ? { effort: session.effort } : {}),
  };
}

async function draftWithClaude(input: { userId: number; projectPath: string; prompt: string }): Promise<string> {
  const { runHeadlessPrompt } = await import('@/modules/agent-run/index.js');
  const result = await runHeadlessPrompt({
    projectPath: input.projectPath,
    prompt: input.prompt,
    userId: input.userId,
    provider: 'claude',
    actor: 'user',
    readOnly: true,
  });
  return String(result?.text ?? '');
}

let service: MasterSessionService | undefined;

export function getMasterSessionService(): MasterSessionService {
  return service ??= createMasterSessionService({
    attention: sessionAttention,
    pendingAnswers,
    send: ({ sessionId, userId, content }) => {
      if (!runControl) {
        console.error('[MasterSession] chat gateway is not wired — text answer not sent', { sessionId });
        return false;
      }
      return runControl.start({ sessionId, userId, parentSessionId: sessionId, content, options: runOptionsFor(sessionId) });
    },
    drafts: draftWithClaude,
    sessionProjectPath: (sessionId) => sessionsDb.getSessionById(sessionId)?.project_path ?? null,
  });
}

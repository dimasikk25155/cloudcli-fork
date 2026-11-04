/**
 * Чистая модель мастер-сессии: ответы на ждущие вопросы всех чатов,
 * черновики модели, экран проверки и пачка для `POST /api/master-session/send`.
 * Форматы зеркалят `server/modules/master-session/master-session.service.ts`.
 */

export type MasterQuestionChoice = { id: string; label: string };

export type MasterQuestion = {
  sessionId: string;
  projectId: string;
  projectName: string;
  provider: string;
  title: string | null;
  reason: string | null;
  updatedAt: string;
  question: string;
  excerpt: string | null;
  mode: 'choice' | 'text';
  choices: MasterQuestionChoice[];
};

export type MasterDraft = { sessionId: string; text: string; choice?: string; updatedAt: string };

export type MasterSendItem = {
  sessionId: string;
  expectedUpdatedAt: string;
  answer: { choice?: string; text?: string };
};

export type MasterSendResult = { sessionId: string; status: 'sent' | 'stale' | 'failed'; reason?: string };

/**
 * Ответ на один вопрос. `preparedFor` — состояние чата (`updatedAt`), для
 * которого ответ написан: обновление списка его не меняет, поэтому ответ на
 * старый вопрос не уйдёт молча в новый — сервер скажет «вопрос изменился».
 */
export type MasterAnswerDraft = { choice?: string; text: string; preparedFor: string; fromDraft?: boolean };

export type MasterAnswers = Record<string, MasterAnswerDraft>;

export type MasterReviewRow = { sessionId: string; target: string; answer: string; changed: boolean };

export function setAnswer(
  answers: MasterAnswers,
  question: MasterQuestion,
  patch: { choice?: string; text?: string },
): MasterAnswers {
  const previous = answers[question.sessionId];
  const next: MasterAnswerDraft = {
    text: patch.text ?? previous?.text ?? '',
    preparedFor: previous?.preparedFor ?? question.updatedAt,
  };
  const choice = patch.choice !== undefined ? patch.choice : previous?.choice;
  if (choice) next.choice = choice;
  return { ...answers, [question.sessionId]: next };
}

/** Черновики заполняют только нетронутые вопросы и только для того же состояния чата. */
export function applyDrafts(answers: MasterAnswers, questions: readonly MasterQuestion[], drafts: readonly MasterDraft[]): MasterAnswers {
  const bySession = new Map(questions.map((question) => [question.sessionId, question] as const));
  let next = answers;
  for (const draft of drafts) {
    const question = bySession.get(draft.sessionId);
    if (!question || question.updatedAt !== draft.updatedAt) continue;
    const current = next[draft.sessionId];
    if (current && (current.text.trim() || current.choice)) continue;
    const choice = draft.choice && question.choices.some((entry) => entry.id === draft.choice) ? draft.choice : undefined;
    if (!choice && !draft.text.trim()) continue;
    next = {
      ...next,
      [draft.sessionId]: { ...(choice ? { choice } : {}), text: draft.text, preparedFor: question.updatedAt, fromDraft: true },
    };
  }
  return next;
}

function answerOf(question: MasterQuestion, draft: MasterAnswerDraft | undefined): { choice?: string; text?: string } | null {
  if (!draft) return null;
  const text = draft.text.trim();
  if (text) return { text };
  if (draft.choice && question.choices.some((entry) => entry.id === draft.choice)) return { choice: draft.choice };
  return null;
}

/** Только отвеченные вопросы; текст важнее выбранного варианта. */
export function buildSendItems(questions: readonly MasterQuestion[], answers: MasterAnswers): MasterSendItem[] {
  return questions.flatMap((question) => {
    const draft = answers[question.sessionId];
    const answer = answerOf(question, draft);
    return answer && draft ? [{ sessionId: question.sessionId, expectedUpdatedAt: draft.preparedFor, answer }] : [];
  });
}

/** Экран проверки: «проект · чат → что уйдёт». `changed` — вопрос обновился после ответа. */
export function reviewRows(questions: readonly MasterQuestion[], answers: MasterAnswers): MasterReviewRow[] {
  return questions.flatMap((question) => {
    const draft = answers[question.sessionId];
    const answer = answerOf(question, draft);
    if (!answer || !draft) return [];
    const label = answer.text ?? question.choices.find((entry) => entry.id === answer.choice)?.label ?? '';
    return [{
      sessionId: question.sessionId,
      target: `${question.projectName || question.projectId} · ${question.title?.trim() || 'без названия'}`,
      answer: label,
      changed: question.updatedAt !== draft.preparedFor,
    }];
  });
}

const FAILURE_REASONS: Record<string, string> = {
  forbidden: 'нет доступа к этому чату',
  bad_answer: 'нет ответа или такого варианта',
  not_pending: 'вопрос уже закрыт',
  unavailable: 'движок не принял ответ',
  in_progress: 'ответ уже доставляется',
  not_started: 'в чате идёт работа или движок недоступен',
};

export function resultLabel(result: MasterSendResult): string {
  if (result.status === 'sent') return 'Отправлено';
  if (result.status === 'stale') return 'Вопрос изменился — не отправлено';
  const reason = result.reason ? FAILURE_REASONS[result.reason] : undefined;
  return reason ? `Не отправлено: ${reason}` : 'Не отправлено';
}

/** Идентификатор одного нажатия «Отправить всё» (повтор с ним не шлёт дважды). */
export function newBatchId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `ms-${random}`;
}

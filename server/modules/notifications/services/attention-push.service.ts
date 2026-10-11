/**
 * "Нужен ответ" push for every engine.
 *
 * Subscribed to session-attention: when a session starts waiting for the user
 * (Claude/Grok question, plan, permission; any engine whose turn ended with a
 * question or a request to do something by hand) the user who started the run
 * gets exactly one push per request. Answerable requests carry one-time
 * buttons; the push stays up until the session stops waiting, then it is
 * closed by tag — whichever channel answered.
 */

import { ATTENTION_PUSH_CODE, attentionPushTag } from '@/modules/notifications/services/attention-push.constants.js';
import {
  createNotificationEvent,
  notifyUserIfEnabled,
} from '@/modules/notifications/services/notification-orchestrator.service.js';
import {
  pendingAnswers,
  type AnswerChoice,
  type IssuedToken,
} from '@/modules/pending-answers/pending-answers.service.js';
import type { AttentionChange } from '@/modules/session-attention/session-attention.service.js';

/** Android shows at most two notification buttons. */
const MAX_PUSH_ANSWER_BUTTONS = 2;
const PUSHED_KEY_TTL_MS = 24 * 60 * 60 * 1000;


export type AttentionPushAction = { action: string; title: string };

export type AttentionPushPlan = {
  /** Choices that become one-time answer tokens, in button order. */
  choices: AnswerChoice[];
  /** Whether an «Открыть» button follows the answer buttons. */
  withOpenButton: boolean;
};

/**
 * Which buttons a waiting session gets (Решение 16):
 * - one question, single choice → its first two options;
 * - plan → «Одобрить» + «Открыть»;
 * - permission → «Разрешить» / «Отклонить»;
 * - anything else (several questions, multiselect, text question, manual
 *   ask, no request id to answer) → «Открыть» only.
 * Tapping the notification body always opens the session.
 */
export function planAttentionPush(change: Pick<AttentionChange, 'reason' | 'detail'>): AttentionPushPlan {
  const requestId = change.detail?.requestId;
  if (!requestId) {
    return { choices: [], withOpenButton: true };
  }

  if (change.reason === 'ask') {
    const questions = change.detail?.questions ?? [];
    const only = questions.length === 1 ? questions[0] : null;
    if (!only || only.multiSelect || only.options.length === 0) {
      return { choices: [], withOpenButton: true };
    }
    return {
      choices: only.options.slice(0, MAX_PUSH_ANSWER_BUTTONS).map((option, index) => ({
        id: `opt${index + 1}`,
        label: option.label,
        decision: { allow: true, answers: { [only.question]: option.label } },
      })),
      withOpenButton: false,
    };
  }

  if (change.reason === 'plan') {
    return {
      choices: [{ id: 'approve', label: 'Одобрить', decision: { allow: true } }],
      withOpenButton: true,
    };
  }

  if (change.reason === 'permission') {
    return {
      choices: [
        { id: 'allow', label: 'Разрешить', decision: { allow: true } },
        { id: 'deny', label: 'Отклонить', decision: { allow: false } },
      ],
      withOpenButton: false,
    };
  }

  return { choices: [], withOpenButton: true };
}

type NotifyFn = (input: { userId: number; event: ReturnType<typeof createNotificationEvent> }) => void;
type IssueTokensFn = (requestId: string, userId: number, choices: AnswerChoice[]) => IssuedToken[];

export type AttentionPushDependencies = {
  notify?: NotifyFn;
  issueTokens?: IssueTokensFn;
  now?: () => number;
};

export function createAttentionPushListener(dependencies: AttentionPushDependencies = {}) {
  const notify: NotifyFn = dependencies.notify ?? ((input) => notifyUserIfEnabled(input));
  const issueTokens: IssueTokensFn = dependencies.issueTokens
    ?? ((requestId, userId, choices) => pendingAnswers.issueTokens(requestId, userId, choices));
  const now = dependencies.now ?? (() => Date.now());

  /** Requests already pushed (dedupe): session + request id, or session + turn time for text endings. */
  const pushedKeys = new Map<string, number>();
  /** Who got the currently shown push of a session — the close goes to them. */
  const shownTo = new Map<string, number>();

  function prune(): void {
    const cutoff = now() - PUSHED_KEY_TTL_MS;
    for (const [key, at] of pushedKeys) {
      if (at < cutoff) {
        pushedKeys.delete(key);
      }
    }
  }

  function close(change: AttentionChange): void {
    const recipients = new Set<number>();
    const shown = shownTo.get(change.sessionId);
    if (shown !== undefined) recipients.add(shown);
    if (change.userId !== null) recipients.add(change.userId);
    shownTo.delete(change.sessionId);
    const tag = attentionPushTag(change.sessionId);
    for (const userId of recipients) {
      notify({
        userId,
        event: createNotificationEvent({
          provider: change.provider,
          sessionId: change.sessionId,
          code: 'notification.close',
          meta: { tag },
          dedupeKey: `attention-close:${change.sessionId}:${change.updatedAt}:${userId}`,
        }),
      });
    }
  }

  return function onAttentionChange(change: AttentionChange): void {
    const wasWaiting = change.previous?.state === 'waiting';
    if (change.state !== 'waiting') {
      if (wasWaiting) {
        close(change);
      }
      return;
    }

    const requestId = change.detail?.requestId ?? null;
    const isNewRequest = !wasWaiting || (requestId !== null && requestId !== change.previous?.requestId);
    if (!isNewRequest || change.userId === null) {
      return;
    }

    prune();
    const key = `${change.sessionId}:${requestId ?? `turn:${change.updatedAt}`}`;
    if (pushedKeys.has(key)) {
      return;
    }
    pushedKeys.set(key, now());

    const plan = planAttentionPush(change);
    let tokens: IssuedToken[] = [];
    if (requestId && plan.choices.length > 0) {
      try {
        tokens = issueTokens(requestId, change.userId, plan.choices);
      } catch (error) {
        // Buttons are a convenience; the push itself must still go out.
        console.error('[AttentionPush] could not issue answer tokens', { sessionId: change.sessionId, error: (error as Error)?.message });
      }
    }

    const actions: AttentionPushAction[] = tokens.map((token) => ({ action: `answer:${token.id}`, title: token.label }));
    const answers: Record<string, string> = Object.fromEntries(tokens.map((token) => [`answer:${token.id}`, token.token]));
    if (plan.withOpenButton || tokens.length === 0) {
      actions.push({ action: 'open', title: 'Открыть' });
    }

    shownTo.set(change.sessionId, change.userId);
    notify({
      userId: change.userId,
      event: createNotificationEvent({
        provider: change.provider,
        sessionId: change.sessionId,
        kind: 'action_required',
        code: ATTENTION_PUSH_CODE,
        meta: {
          reason: change.reason,
          question: change.detail?.question ?? null,
          options: change.detail?.options ?? [],
          questionCount: change.detail?.questions?.length ?? 0,
          excerpt: change.detail?.excerpt ?? null,
          actions,
          answers,
        },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `attention:${key}`,
      }),
    });
  };
}

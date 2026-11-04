import React, { useEffect } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';

import { cn } from '../../lib/utils';

import { resultLabel, reviewRows, buildSendItems, type MasterQuestion } from './masterSessionModel';
import { masterSessionStore, useMasterSession } from './masterSessionStore';

type MasterSessionSectionProps = {
  /** Переход в чат вопроса; нет — без ссылки. */
  onOpenSession?: (sessionId: string) => void;
  /** Перечитать вопросы, когда меняются статусы чатов (ключ — любой отпечаток списка). */
  refreshKey?: string;
};

function targetOf(question: MasterQuestion): string {
  return `${question.projectName || question.projectId} · ${question.title?.trim() || 'без названия'}`;
}

/**
 * «Мастер-сессия»: все ждущие вопросы доступных чатов, ответ на каждый
 * (вариант или текст), черновики модели, экран проверки «чат → текст» и
 * «Отправить всё» одним действием.
 */
export default function MasterSessionSection({ onOpenSession, refreshKey }: MasterSessionSectionProps) {
  const session = useMasterSession();

  useEffect(() => {
    if (session.phase === 'edit') void masterSessionStore.refresh();
    // Фаза в зависимостях не нужна: проверка и итог показывают зафиксированный список.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (session.phase === 'review' || session.phase === 'done') {
    return <MasterSessionReview onOpenSession={onOpenSession} />;
  }

  const { questions, answers } = session;
  const answeredCount = buildSendItems(questions, answers).length;

  return (
    <div className="flex flex-col gap-3" data-master-session>
      {session.error && <p role="alert" className="text-xs text-destructive">{session.error}</p>}
      {session.loaded && questions.length === 0 && !session.error && (
        <p className="text-xs text-muted-foreground">Сейчас ни один чат не ждёт ответа.</p>
      )}

      {questions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void masterSessionStore.prepareDrafts()}
            disabled={session.drafting}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
          >
            {session.drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            {session.drafting ? 'Готовлю черновики…' : 'Подготовить ответы'}
          </button>
          <span className="text-xs text-muted-foreground">Черновики можно править; модель только читает.</span>
        </div>
      )}
      {session.draftError && <p role="alert" className="text-xs text-destructive">{session.draftError}</p>}

      <ul className="flex flex-col gap-2">
        {questions.map((question) => {
          const answer = answers[question.sessionId];
          const changed = Boolean(answer && answer.preparedFor !== question.updatedAt);
          return (
            <li key={question.sessionId} className="rounded-lg border border-border/60 bg-card p-2.5 text-sm">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{targetOf(question)}</span>
                <span className="flex-shrink-0">{question.provider}</span>
                {onOpenSession && (
                  <button type="button" className="flex-shrink-0 underline-offset-2 hover:underline" onClick={() => onOpenSession(question.sessionId)}>
                    Открыть
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{question.question || 'Агент ждёт ответа'}</p>
              {question.excerpt && question.excerpt !== question.question && (
                <details className="mt-1 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Что написал агент</summary>
                  <p className="mt-1 whitespace-pre-wrap">{question.excerpt}</p>
                </details>
              )}
              {question.choices.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Варианты ответа">
                  {question.choices.map((choice) => {
                    const selected = answer?.choice === choice.id && !answer.text.trim();
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => masterSessionStore.answer(question, { choice: choice.id, text: '' })}
                        className={cn(
                          'min-h-[32px] rounded-md border px-2.5 text-xs',
                          selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:bg-accent',
                        )}
                      >
                        {choice.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <textarea
                value={answer?.text ?? ''}
                onChange={(event) => masterSessionStore.answer(question, { text: event.target.value })}
                placeholder={question.choices.length > 0 ? 'Или ответь своими словами' : 'Текст ответа'}
                rows={2}
                className="mt-2 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {answer?.fromDraft && <p className="mt-1 text-[11px] text-muted-foreground">Черновик модели — проверь перед отправкой.</p>}
              {changed && <p className="mt-1 text-[11px] text-warning">Вопрос изменился после ответа — такой ответ не уйдёт.</p>}
            </li>
          );
        })}
      </ul>

      {questions.length > 0 && (
        <button
          type="button"
          onClick={() => masterSessionStore.review()}
          disabled={answeredCount === 0}
          className="inline-flex min-h-[36px] items-center justify-center gap-1.5 self-end rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Проверить ответы ({answeredCount})
        </button>
      )}
    </div>
  );
}

/** Экран проверки и итог: кому и что уйдёт, затем — что дошло. */
function MasterSessionReview({ onOpenSession }: { onOpenSession?: (sessionId: string) => void }) {
  const session = useMasterSession();
  const rows = reviewRows(session.questions, session.answers);
  const bySession = new Map(session.questions.map((question) => [question.sessionId, question] as const));

  if (session.phase === 'done') {
    return (
      <div className="flex flex-col gap-2" data-master-session-results>
        <ul className="flex flex-col gap-1.5">
          {session.results.map((result) => {
            const question = bySession.get(result.sessionId);
            return (
              <li key={result.sessionId} className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{question ? targetOf(question) : result.sessionId}</span>
                <span className={cn('flex-shrink-0 text-xs', result.status === 'sent' ? 'text-success' : result.status === 'stale' ? 'text-warning' : 'text-destructive')}>
                  {resultLabel(result)}
                </span>
                {onOpenSession && (
                  <button type="button" className="flex-shrink-0 text-xs underline-offset-2 hover:underline" onClick={() => onOpenSession(result.sessionId)}>
                    Открыть
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => masterSessionStore.finish()}
          className="min-h-[36px] self-end rounded-md border border-border px-3 text-sm hover:bg-accent"
        >
          Готово
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-master-session-review>
      <p className="text-xs text-muted-foreground">Проверь, кому и что уйдёт. Изменившиеся вопросы не получат ответ.</p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.sessionId} className="rounded-md border border-border/60 bg-card px-2.5 py-2 text-sm">
            <div className="text-xs text-muted-foreground">{row.target} →</div>
            <p className="mt-0.5 whitespace-pre-wrap text-foreground">{row.answer}</p>
            {row.changed && <p className="mt-1 text-[11px] text-warning">Вопрос изменился — не отправится.</p>}
          </li>
        ))}
      </ul>
      {session.sendError && <p role="alert" className="text-xs text-destructive">{session.sendError}. Можно нажать ещё раз — дважды не уйдёт.</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => masterSessionStore.backToEdit()}
          disabled={session.sending}
          className="min-h-[36px] rounded-md border border-border px-3 text-sm hover:bg-accent disabled:opacity-50"
        >
          Назад
        </button>
        <button
          type="button"
          onClick={() => void masterSessionStore.sendAll()}
          disabled={session.sending || rows.length === 0}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {session.sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          Отправить всё ({rows.length})
        </button>
      </div>
    </div>
  );
}

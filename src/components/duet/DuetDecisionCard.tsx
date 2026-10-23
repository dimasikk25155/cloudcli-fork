import React, { useState } from 'react';
import { BellOff, Loader2, RotateCw, Wrench, X } from 'lucide-react';

import { cn } from '../../lib/utils';

import { decide } from './duetApi';
import { DECISION_STATUS, whenAgo, type DuetChoice, type DuetDecision } from './duetModel';

const CHOICE_ICON: Record<DuetChoice, typeof RotateCw> = {
  restart: RotateCw,
  fix: Wrench,
  mute: BellOff,
  dismiss: X,
};

const TONE: Record<string, string> = {
  busy: 'text-primary',
  ok: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  muted: 'text-muted-foreground',
};

/**
 * Одно решение Дуэта: что случилось и кнопки. Первая кнопка — то, что Дуэт
 * советует. Используется в окне Дуэта и в хабе «Ждут тебя».
 */
export default function DuetDecisionCard({
  decision,
  onChanged,
  compact = false,
}: {
  decision: DuetDecision;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<DuetChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = decision.status === 'pending';
  const status = DECISION_STATUS[decision.status];

  const choose = async (choice: DuetChoice) => {
    setBusy(choice);
    setError(null);
    try {
      await decide(decision.id, choice);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const buttons = pending ? [...decision.options, { choice: 'dismiss' as const, label: 'Не надо' }] : [];

  return (
    <div
      className={cn(
        'rounded-xl border bg-card px-3.5 py-3',
        pending ? 'border-rose-300/60 dark:border-rose-800/50' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{decision.title}</div>
          {!compact && decision.body && (
            <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{decision.body}</div>
          )}
        </div>
        {!pending && (
          <div className={cn('flex flex-shrink-0 items-center gap-1 text-[11px]', TONE[status.tone])}>
            {decision.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
            {status.label}
          </div>
        )}
      </div>

      {decision.result && !pending && (
        <div className={cn('mt-2 text-xs', TONE[status.tone])}>{decision.result}</div>
      )}

      {buttons.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {buttons.map((option, index) => {
            const Icon = CHOICE_ICON[option.choice];
            const primary = index === 0;
            return (
              <button
                key={option.choice}
                type="button"
                disabled={busy !== null}
                onClick={() => void choose(option.choice)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                  primary
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border text-foreground hover:bg-muted/60',
                )}
              >
                {busy === option.choice ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/80">
        <span>{decision.source === 'brief' ? 'из брифа' : 'сторож'}</span>
        <span>·</span>
        <span>{whenAgo(decision.createdAt)}</span>
        {decision.via === 'telegram' && (
          <>
            <span>·</span>
            <span>ответ из Telegram</span>
          </>
        )}
      </div>
      {error && <div className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  );
}

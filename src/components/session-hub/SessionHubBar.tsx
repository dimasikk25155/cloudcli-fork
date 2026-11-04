import React, { useCallback, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModEnabled } from '../../hooks/useModEnabled';
import { cn } from '../../lib/utils';
import type { AttentionItem } from '../attention/types';
import { useAttention } from '../attention/useAttention';

import SessionHubPanel from './SessionHubPanel';
import { sessionHubBar } from './sessionHubModel';

type SessionHubBarProps = {
  /** Переход в сессию по id (в любом проекте). */
  onOpenSession: (sessionId: string) => void;
};

/**
 * Полоса над полем ввода: «работают N · ждут N · готово N» по всем доступным
 * проектам и движкам. Клик открывает правую панель «Диалоги». Мод
 * «Панель диалогов» выключен — полосы нет.
 */
export default function SessionHubBar({ onOpenSession }: SessionHubBarProps) {
  const hubOn = useModEnabled('modSessionHub');
  const { items } = useAttention();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('sidebar');
  const getProviderLabel = useCallback(
    (provider: string) => t(`projects.providers.${provider}`, { defaultValue: provider }),
    [t],
  );

  if (!hubOn) {
    return null;
  }
  const bar = sessionHubBar(items);
  if (!bar.visible && !open) {
    return null;
  }

  return (
    <>
      <div className="mx-auto mb-1.5 flex w-full max-w-[54.25rem] px-2 sm:px-0" data-session-hub-bar>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex min-h-[30px] items-center gap-2 rounded-full border border-border/60 bg-card/90 px-3 text-xs text-muted-foreground backdrop-blur-sm hover:text-foreground"
          title="Все диалоги и мастер-сессия"
        >
          <MessagesSquare className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span className="flex items-center gap-1.5">
            <Dot className="animate-pulse bg-success" on={bar.counts.working > 0} />
            работают {bar.counts.working}
          </span>
          <span aria-hidden>·</span>
          <span className={cn('flex items-center gap-1.5', bar.counts.waiting > 0 && 'font-medium text-foreground')}>
            <Dot className="bg-warning" on={bar.counts.waiting > 0} />
            ждут {bar.counts.waiting}
          </span>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-1.5">
            <Dot className="bg-info" on={bar.counts.done > 0} />
            готово {bar.counts.done}
          </span>
          {bar.counts.failed > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1.5 text-destructive">
                <Dot className="bg-destructive" on />
                упали {bar.counts.failed}
              </span>
            </>
          )}
        </button>
      </div>
      {open && (
        <SessionHubPanel
          onClose={() => setOpen(false)}
          onOpenSession={(item: AttentionItem) => onOpenSession(item.sessionId)}
          getProviderLabel={getProviderLabel}
        />
      )}
    </>
  );
}

function Dot({ className, on }: { className: string; on: boolean }) {
  return <span className={cn('inline-block h-1.5 w-1.5 rounded-full', on ? className : 'bg-muted-foreground/40')} aria-hidden />;
}

import React, { useEffect, useState } from 'react';
import { Bot, Check, MessagesSquare, X } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Dialog, DialogContent, DialogTitle } from '../../shared/view/ui';
import SessionProviderLogo from '../llm-logo-provider/SessionProviderLogo';
import type { AttentionItem } from '../attention/types';
import { useAttention } from '../attention/useAttention';
import { describeAttention } from '../attention/utils/attentionModel';
import { knownProvider } from '../attention/utils/provider';

import MasterSessionSection from './MasterSessionSection';
import { canMarkRead, sessionHubGroups, type SessionHubGroupKey } from './sessionHubModel';

const AGE_TICK_MS = 30_000;

const DOT: Record<SessionHubGroupKey, string> = {
  waiting: 'bg-warning',
  working: 'bg-success animate-pulse',
  failed: 'bg-destructive',
  done: 'bg-info',
};

type SessionHubPanelProps = {
  onClose: () => void;
  /** Переход в сессию (в любом проекте). */
  onOpenSession: (item: AttentionItem) => void;
  /** Подписи движков, как в сайдбаре. */
  getProviderLabel?: (provider: string) => string;
};

/**
 * Правая выдвижная панель «Диалоги»: мастер-сессия сверху, ниже — все чаты
 * всех доступных проектов по состояниям. «Прочитано» снимает только отметку:
 * работающий чат и открытый вопрос оно не останавливает и не завершает.
 */
export default function SessionHubPanel({ onClose, onOpenSession, getProviderLabel }: SessionHubPanelProps) {
  const { items, byId, markSeen, refresh } = useAttention();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [tab, setTab] = useState<'chats' | 'master'>('chats');

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => setNowMs(Date.now()), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const groups = sessionHubGroups(items);
  const waitingKey = items.filter((entry) => entry.state === 'waiting').map((entry) => `${entry.sessionId}@${entry.updatedAt}`).join('|');
  const waitingCount = items.filter((entry) => entry.state === 'waiting').length;

  const open = (item: AttentionItem) => {
    onClose();
    onOpenSession(item);
  };
  const openById = (sessionId: string) => {
    const item = byId.get(sessionId);
    if (item) open(item);
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={cn(
          'left-auto right-0 top-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden',
          'rounded-none border-0 border-l border-border bg-background p-0 text-foreground shadow-2xl md:max-w-md',
        )}
      >
        <DialogTitle>Диалоги</DialogTitle>
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessagesSquare className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
            <h2 className="truncate text-sm font-semibold">Диалоги</h2>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg hover:bg-accent"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
        </div>

        <div className="flex flex-shrink-0 gap-1 border-b border-border px-3 py-2" role="tablist">
          {([['chats', 'Все чаты'], ['master', `Мастер-сессия${waitingCount ? ` (${waitingCount})` : ''}`]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn('min-h-[32px] rounded-md px-3 text-xs font-medium', tab === key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {tab === 'master' ? (
            <MasterSessionSection onOpenSession={openById} refreshKey={waitingKey} />
          ) : groups.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">Пока ни одного чата со статусом.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <section key={group.key} aria-label={group.title}>
                  <h3 className="mb-1.5 flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
                    <span className={cn('inline-block h-2 w-2 rounded-full', DOT[group.key])} aria-hidden />
                    {group.title} · {group.items.length}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {group.items.map((item) => {
                      const description = describeAttention(item, nowMs);
                      const provider = knownProvider(item.provider);
                      return (
                        <li key={item.sessionId} className={cn('flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/60', !item.unread && group.key === 'done' && 'opacity-70')}>
                          <button type="button" onClick={() => open(item)} className="flex min-w-0 flex-1 flex-col items-start text-left">
                            <span className="flex w-full min-w-0 items-center gap-1.5 text-sm text-foreground">
                              {provider
                                ? <SessionProviderLogo provider={provider} className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                                : <Bot aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
                              <span className="min-w-0 flex-1 truncate">{item.title?.trim() || 'Без названия'}</span>
                            </span>
                            <span className="w-full truncate text-xs text-muted-foreground">
                              {item.projectName || item.projectId} · {getProviderLabel?.(item.provider) ?? item.provider} · {description.ageLabel}
                            </span>
                            {description.summary && <span className="w-full truncate text-xs text-muted-foreground">{description.summary}</span>}
                          </button>
                          {canMarkRead(item) && (
                            <button
                              type="button"
                              onClick={() => void markSeen({ sessionIds: [item.sessionId] })}
                              className="inline-flex min-h-[28px] flex-shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="Снять отметку «новое». Чат не останавливается."
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              Прочитано
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

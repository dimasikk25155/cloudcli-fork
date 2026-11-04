import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useModEnabled } from '../../hooks/useModEnabled';

import { panelStateFor, SAFARI_STATE_TEXT, visibleSafariWindows, type SafariPanelState } from './safariLiveModel';
import { useSafariLive } from './useSafariLive';

type SafariLivePanelProps = {
  sessionId: string | null;
  isActive: boolean;
};

const RESUBSCRIBE_MS = 2000;

const DOT_CLASS: Record<SafariPanelState, string> = {
  live: 'bg-green-500',
  paused: 'bg-amber-400',
  window_gone: 'bg-red-500',
  error: 'bg-red-500',
  no_windows: 'bg-muted-foreground/50',
  no_permission: 'bg-amber-400',
  mod_off: 'bg-muted-foreground/50',
  unsupported: 'bg-muted-foreground/50',
  loading: 'bg-muted-foreground/50',
  pick: 'bg-muted-foreground/50',
};

/**
 * Живая картинка окна Safari, привязанного к чату. Только смотреть: картинка
 * не принимает кликов. Поток (`<img>`) держится открытым, только пока вкладка
 * на виду, — сервер снимает окно, лишь когда кто-то смотрит.
 */
export default function SafariLivePanel({ sessionId, isActive }: SafariLivePanelProps) {
  const modOn = useModEnabled('modSafariLive');
  const { view, failed, select, retry } = useSafariLive(sessionId);
  // Обрыв потока: одна переподписка через 2 с (новый GET → новая ссылка), потом «Повторить».
  const [retried, setRetried] = useState(false);
  const [streamBroken, setStreamBroken] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamUrl = view?.streamUrl ?? null;
  useEffect(() => {
    setStreamBroken(false);
  }, [streamUrl, isActive]);
  useEffect(() => {
    setRetried(false);
  }, [view?.binding?.windowId, view?.binding?.updatedAt]);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleStreamError = useCallback(() => {
    if (retried) {
      setStreamBroken(true);
      return;
    }
    setRetried(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void retry(), RESUBSCRIBE_MS);
  }, [retried, retry]);

  const handleRetry = useCallback(() => {
    setRetried(false);
    setStreamBroken(false);
    void retry();
  }, [retry]);

  const state: SafariPanelState = failed && !view ? 'error' : panelStateFor(view, { isActive, modOn, streamBroken });
  const windows = visibleSafariWindows(view?.windows ?? []);
  const binding = view?.binding ?? null;
  const showList = modOn && view !== null && view.state === 'ok' && (windows.length > 0 || binding !== null);
  const boundTitle = windows.find((window) => window.windowId === binding?.windowId)?.title || binding?.title || '';
  // Список раскрыт сам, когда выбирать нечего, кроме него.
  const listOpenByDefault = state === 'window_gone' || state === 'pick';

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2 text-sm">
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${DOT_CLASS[state]}`} aria-hidden />
        {(state === 'live' || state === 'paused') && (
          <span className="flex-shrink-0 text-xs text-muted-foreground">{state === 'live' ? 'Вживую' : 'Пауза'}</span>
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={boundTitle}>
          {boundTitle}
        </span>
        {showList && (
          <select
            aria-label="Окно Safari"
            data-autofocus={listOpenByDefault ? 'true' : undefined}
            className="max-w-[45%] flex-shrink-0 truncate rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={binding && windows.some((window) => window.windowId === binding.windowId) ? binding.windowId : ''}
            onChange={(event) => void select(Number(event.target.value))}
          >
            <option value="" disabled>
              {windows.length === 0 ? 'Окон нет' : 'Выбрать окно…'}
            </option>
            {windows.map((window) => (
              <option key={window.windowId} value={window.windowId}>
                {window.title}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/5 dark:bg-black/30">
        {state === 'live' && streamUrl ? (
          <img
            key={streamUrl}
            src={streamUrl}
            alt="Окно Safari вживую"
            draggable={false}
            onError={handleStreamError}
            className="pointer-events-none h-full w-full select-none object-contain"
          />
        ) : (
          <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center text-sm text-muted-foreground">
            <p>{SAFARI_STATE_TEXT[state]}</p>
            {state === 'no_permission' && (
              <button type="button" onClick={handleRetry} className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-accent">
                Проверить снова
              </button>
            )}
            {state === 'error' && (
              <button type="button" onClick={handleRetry} className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-accent">
                Повторить
              </button>
            )}
            {(state === 'error' || state === 'unsupported' || state === 'no_permission') && view?.message && (
              <p className="text-xs opacity-70">{view.message}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

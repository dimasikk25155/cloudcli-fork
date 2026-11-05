import React, { useCallback, useEffect, useReducer, useRef } from 'react';

import { useModEnabled } from '../../hooks/useModEnabled';

import {
  STREAM_RECOVERY_START,
  STREAM_RESUBSCRIBE_MS,
  nextStreamRecovery,
  panelStateFor,
  safariBindingKey,
  SAFARI_STATE_TEXT,
  streamUrlEvent,
  visibleSafariWindows,
  type SafariPanelState,
  type StreamRecoveryEvent,
} from './safariLiveModel';
import { usePageVisible } from './usePageVisible';
import { useSafariLive } from './useSafariLive';

type SafariLivePanelProps = {
  sessionId: string | null;
  isActive: boolean;
};

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

const recoveryReducer = (state: typeof STREAM_RECOVERY_START, event: StreamRecoveryEvent) =>
  nextStreamRecovery(state, event, Date.now());

/**
 * Живая картинка окна Safari, привязанного к чату. Только смотреть: картинка
 * не принимает кликов. Поток (`<img>`) держится открытым, только пока вкладка
 * на виду и вкладка браузера с Neo3 не в фоне, — сервер снимает окно, лишь когда кто-то смотрит.
 */
export default function SafariLivePanel({ sessionId, isActive: tabActive }: SafariLivePanelProps) {
  const modOn = useModEnabled('modSafariLive');
  const pageVisible = usePageVisible();
  const isActive = tabActive && pageVisible;
  const { view, failed, select, retry } = useSafariLive(sessionId);
  // Обрыв потока: одна переподписка через 2 с на каждый обрыв после восстановления (модель).
  const [recovery, dispatch] = useReducer(recoveryReducer, STREAM_RECOVERY_START);
  // Новую ссылку попросила сама вкладка (переподписка, «Повторить») — это не обрыв.
  const expectingUrlRef = useRef(false);

  const streamUrl = view?.streamUrl ?? null;
  const binding = view?.binding ?? null;
  const bindingKey = sessionId && binding ? safariBindingKey(sessionId, binding) : null;
  const lastLinkRef = useRef<{ url: string | null; bindingKey: string | null } | null>(null);
  useEffect(() => {
    const next = { url: streamUrl, bindingKey };
    const event = streamUrlEvent(lastLinkRef.current, next, expectingUrlRef.current);
    if (lastLinkRef.current?.url !== next.url) expectingUrlRef.current = false;
    lastLinkRef.current = next;
    if (event) dispatch(event);
  }, [streamUrl, bindingKey]);

  // Вкладка снова на виду — свежая попытка.
  useEffect(() => {
    if (isActive) dispatch('reset');
  }, [isActive]);

  useEffect(() => {
    if (recovery.phase !== 'waiting') return undefined;
    const timer = setTimeout(() => {
      expectingUrlRef.current = true;
      dispatch('resubscribed');
      void retry();
    }, STREAM_RESUBSCRIBE_MS);
    return () => clearTimeout(timer);
  }, [recovery.phase, retry]);

  const handleStreamError = useCallback(() => dispatch('break'), []);
  const handleStreamLoad = useCallback(() => dispatch('recovered'), []);

  const handleRetry = useCallback(() => {
    expectingUrlRef.current = true;
    dispatch('reset');
    void retry();
  }, [retry]);

  const state: SafariPanelState =
    failed && !view
      ? 'error'
      : panelStateFor(view, {
          isActive,
          modOn,
          streamBroken: recovery.phase === 'broken',
          reconnecting: recovery.phase === 'waiting',
        });
  const windows = visibleSafariWindows(view?.windows ?? []);
  const showList = modOn && view !== null && view.state === 'ok' && (windows.length > 0 || binding !== null);
  const boundTitle = windows.find((window) => window.pageId === binding?.pageId)?.title || binding?.title || '';
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
            value={binding && windows.some((window) => window.pageId === binding.pageId) ? binding.pageId : ''}
            onChange={(event) => void select(event.target.value)}
          >
            <option value="" disabled>
              {windows.length === 0 ? 'Окон нет' : 'Выбрать окно…'}
            </option>
            {windows.map((window) => (
              <option key={window.pageId} value={window.pageId}>
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
            onLoad={handleStreamLoad}
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

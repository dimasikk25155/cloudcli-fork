import React, { useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';

import { useModEnabled } from '../../../hooks/useModEnabled';
import { normalizeProviderLimits, type ProviderLimitWindow } from '../../../utils/providerLimits';
import { formatResetMoscow } from '../../../utils/usageLimits';
import { useAutoRelay } from '../../relay';
import { useSessionEngine, useSessionTokenUsage, useUsageLimitsBody } from '../useSessionFacts';
import type { WorkbenchRenderContext } from '../workbenchTabs';

const ENGINE_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok' };
const tokens = (value: number) => value.toLocaleString('ru-RU');

// The chat itself follows a finished move (ChatInterface); the card only starts it.
const ignoreMoved = () => {};

function tone(pct: number | null): string {
  if (pct === null) return 'bg-muted-foreground/30';
  if (pct >= 85) return 'bg-red-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-primary';
}

function Meter({ pct, label }: { pct: number | null; label: string }) {
  const width = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(pct)}
    >
      <div className={`h-full rounded-full ${tone(pct)} transition-[width] duration-300`} style={{ width: `${width}%` }} />
    </div>
  );
}

function WindowRow({ window }: { window: ProviderLimitWindow }) {
  return (
    <div className="space-y-1.5" data-limit-window={window.label}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-foreground">{window.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {window.utilization === null ? 'неизвестно' : `${Math.round(window.utilization)}%`}
        </span>
      </div>
      <Meter pct={window.utilization} label={`Лимит «${window.label}»`} />
      <div className="text-xs text-muted-foreground">
        Сброс: {window.resetsAt ? formatResetMoscow(window.resetsAt, true) : 'неизвестно'}
      </div>
    </div>
  );
}

/** «Контекст и лимиты»: occupancy of the chat, subscription windows, «Перенести». */
export default function ContextLimitsCard({ context }: { context: WorkbenchRenderContext }) {
  const { project, session, sessionId } = context;
  const engine = useSessionEngine(session);
  const usage = useSessionTokenUsage(project.projectId, sessionId);
  const limitsBody = useUsageLimitsBody(engine.provider);
  const limits = normalizeProviderLimits(engine.provider, {
    tokenUsage: usage,
    contextWindow: engine.contextWindow,
    limits: limitsBody,
  });
  const relayOn = useModEnabled('modRelay');
  const relay = useAutoRelay(relayOn ? sessionId : null, ignoreMoved);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const engineName = engine.provider ? ENGINE_NAMES[engine.provider] ?? engine.provider : 'Этот движок';
  const relayBusy = moving || relay.status?.state === 'collecting' || relay.status?.state === 'creating';

  const startMove = () => {
    setMoving(true);
    setMoveError(null);
    relay.startNow()
      .catch((error: unknown) => setMoveError(error instanceof Error ? error.message : 'Перенос не начать'))
      .finally(() => setMoving(false));
  };

  const { used, window, usedPct } = limits.context;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4" data-workbench-limits>
      <section className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Контекст</h3>
          <span className="text-sm tabular-nums text-foreground">
            {usedPct === null ? 'неизвестно' : `${Math.round(usedPct)}%`}
          </span>
        </div>
        <Meter pct={usedPct} label="Заполненность контекста" />
        <p className="text-xs text-muted-foreground">
          {used === null
            ? 'Движок ещё не сообщил занятость контекста.'
            : window === null
              ? `${tokens(used)} токенов; окно модели неизвестно.`
              : `${tokens(used)} из ${tokens(window)} токенов окна модели.`}
        </p>
        {sessionId && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={startMove}
              disabled={!relayOn || relayBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {relayBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRightLeft className="h-4 w-4" aria-hidden />}
              {relayBusy ? 'Переношу…' : 'Перенести'}
            </button>
            <span className="text-xs text-muted-foreground">
              {relayOn ? 'Продолжить в новом чате со всем, что уже сделано.' : 'Мод «Перенести» выключен в настройках.'}
            </span>
          </div>
        )}
        {moveError && <p className="text-xs text-destructive">{moveError}</p>}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Лимиты подписки</h3>
        {!limits.known ? (
          <p className="text-sm text-muted-foreground" data-limits-unknown>
            {engineName} лимиты не сообщает.
          </p>
        ) : limits.windows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Лимиты пока неизвестны — {engineName} их ещё не прислал.</p>
        ) : (
          limits.windows.map((entry) => <WindowRow key={entry.label} window={entry} />)
        )}
      </section>
    </div>
  );
}

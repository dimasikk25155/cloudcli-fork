import { ArrowRightLeft, Loader2 } from 'lucide-react';

import { Button } from '../../shared/view/ui/Button';

import type { RelaySuggestion } from './useRelaySuggestion';

type RelayBandProps = {
  relay: RelaySuggestion;
};

function headline(relay: RelaySuggestion): string {
  if (relay.reason === 'context') {
    return relay.contextPercent !== null
      ? `Контекст занят на ${relay.contextPercent}% — чат начнёт тупить`
      : 'Контекст сильно разросся — чат начнёт тупить';
  }
  return 'Чату больше 12 часов';
}

/**
 * One band over the composer: «Перенести в новый чат» / «Не сейчас», then
 * «Собираю записку…» while the agent writes the handoff note, «Открываю новый
 * чат…» (cancellable, times out), an error if the note was not found, or
 * «Новый чат готов → Открыть» when it was created while another chat was open.
 * Visibility and the flow live in useRelaySuggestion.
 */
export default function RelayBand({ relay }: RelayBandProps) {
  if (!relay.show) {
    return null;
  }
  const { phase, error } = relay.state;
  const busy = phase === 'collecting' || phase === 'creating';

  return (
    <div
      className="settings-content-enter mx-auto mb-2 max-w-[54.25rem] rounded-xl border border-primary/25 bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur-md"
      data-testid="relay-band"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        {busy ? (
          <Loader2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary/70" />
        ) : (
          <ArrowRightLeft aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
        )}
        <div className="min-w-0 flex-1">
          {phase === 'creating' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={relay.reset}>
            Отменить
          </Button>
        </div>
      )}
      {phase === 'done' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" className="h-9 px-3" onClick={relay.openChild}>
            Открыть
          </Button>
          <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={relay.reset}>
            Закрыть
          </Button>
        </div>
      )}
      {phase === 'collecting' && (
            <>
              <p className="text-sm text-foreground">Собираю записку…</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Агент пишет эстафету, потом откроется новый чат</p>
            </>
          )}
          {phase === 'creating' && <p className="text-sm text-foreground">Открываю новый чат…</p>}
          {phase === 'done' && (
            <>
              <p className="text-xs font-medium text-primary/80">Новый чат готов</p>
              <p className="mt-0.5 text-sm text-foreground">Записка передана, продолжение ждёт в новом чате</p>
            </>
          )}
          {phase === 'error' && (
            <>
              <p className="text-xs font-medium text-destructive">Перенос не удался</p>
              <p className="mt-0.5 break-words text-sm text-foreground">{error}</p>
            </>
          )}
          {phase === 'idle' && (
            <>
              <p className="text-xs font-medium text-primary/80">{headline(relay)}</p>
              <p className="mt-0.5 text-sm text-foreground">Перенести в новый чат? Агент соберёт записку, новый чат её прочитает</p>
            </>
          )}
        </div>
      </div>

      {phase === 'idle' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" className="h-9 px-3" onClick={relay.start}>
            Перенести
          </Button>
          <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={relay.dismiss}>
            Не сейчас
          </Button>
        </div>
      )}
      {phase === 'collecting' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" className="h-9 px-3" disabled>
            Перенести
          </Button>
          <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={relay.reset}>
            Отменить
          </Button>
        </div>
      )}
      {phase === 'error' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" className="h-9 px-3" onClick={relay.start}>
            Повторить
          </Button>
          <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={() => { relay.reset(); relay.dismiss(); }}>
            Закрыть
          </Button>
        </div>
      )}
    </div>
  );
}

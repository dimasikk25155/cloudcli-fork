import type { ReactNode } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';

import { Button } from '../../shared/view/ui/Button';

import { autoRelayBandMode } from './autoRelayModel';
import type { AutoRelayControl } from './useAutoRelay';
import type { RelaySuggestion } from './useRelaySuggestion';

type RelayBandProps = {
  relay: RelaySuggestion;
  /** «Авто-перенос» of the open chat (server-side move). */
  autoRelay?: AutoRelayControl;
  /** Opens a chat (the continuation of an already moved chat). */
  onOpenChat?: (sessionId: string) => void;
};

function headline(relay: RelaySuggestion): string {
  if (relay.reason === 'context') {
    return relay.contextPercent !== null
      ? `Контекст занят на ${relay.contextPercent}% — чат начнёт тупить`
      : 'Контекст сильно разросся — чат начнёт тупить';
  }
  return 'Чату больше 12 часов';
}

function AutoRelaySwitch({ checked, onChange, showLabel = true }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  showLabel?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Авто-перенос"
      onClick={() => onChange(!checked)}
      className="flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="auto-relay-switch"
    >
      {showLabel && <span>Авто-перенос</span>}
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  );
}

function Shell({ busy, children, actions }: { busy: boolean; children: ReactNode; actions?: ReactNode }) {
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
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {actions && <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/**
 * One band over the composer.
 * Manual relay: «Перенести в новый чат» / «Не сейчас», then «Собираю записку…»,
 * «Открываю новый чат…» (cancellable, times out), an error, or «Новый чат
 * готов → Открыть». Auto-relay (server): «Авто-перенос включён…» while armed,
 * «Переношу…» while the server moves the chat, «Перенёс → Открыть» on an
 * already moved chat, or the failure told once.
 */
export default function RelayBand({ relay, autoRelay, onOpenChat }: RelayBandProps) {
  const auto = autoRelay?.status ?? null;
  const autoMode = autoRelayBandMode(auto);
  const { phase, error } = relay.state;
  const switchRow = autoRelay && auto
    ? <AutoRelaySwitch checked={auto.enabled} onChange={autoRelay.setEnabled} />
    : null;

  // The server is moving the chat: nothing else applies meanwhile.
  if (autoMode === 'moving') {
    return (
      <Shell busy>
        <p className="text-xs font-medium text-primary/80">Авто-перенос</p>
        <p className="mt-0.5 text-sm text-foreground" data-testid="auto-relay-moving">
          Переношу в новый чат…
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">Агент пишет записку, новый чат откроется сам</p>
      </Shell>
    );
  }

  if (autoMode === 'moved' && auto?.childSessionId && phase === 'idle') {
    const childId = auto.childSessionId;
    return (
      <Shell
        busy={false}
        actions={onOpenChat ? (
          <Button size="sm" className="h-9 px-3" onClick={() => onOpenChat(childId)}>
            Открыть
          </Button>
        ) : undefined}
      >
        <p className="text-xs font-medium text-primary/80">Чат перенесён</p>
        <p className="mt-0.5 break-words text-sm text-foreground">
          Перенёс в новый чат{auto.childTitle ? `: ${auto.childTitle}` : ''}
        </p>
      </Shell>
    );
  }

  if (autoMode === 'failed' && phase === 'idle') {
    return (
      <Shell
        busy={false}
        actions={(
          <>
            <Button size="sm" className="h-9 px-3" onClick={relay.start}>
              Перенести вручную
            </Button>
            <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={() => autoRelay?.setEnabled(false)}>
              Закрыть
            </Button>
          </>
        )}
      >
        <p className="text-xs font-medium text-destructive">Авто-перенос не получился</p>
        <p className="mt-0.5 break-words text-sm text-foreground">{auto?.error ?? 'Записку не нашёл — авто-перенос выключен'}</p>
      </Shell>
    );
  }

  if (!relay.show) {
    if (autoMode !== 'armed') {
      return null;
    }
    // Armed, chat not grown yet: one quiet line with the switch to turn it off.
    return (
      <div
        className="settings-content-enter mx-auto mb-2 flex max-w-[54.25rem] items-center gap-2.5 rounded-xl border border-primary/20 bg-card/95 py-1 pl-3 pr-1.5 shadow-sm backdrop-blur-md"
        data-testid="relay-band"
        role="status"
      >
        <ArrowRightLeft aria-hidden className="h-4 w-4 shrink-0 text-primary/70" />
        <p className="min-w-0 flex-1 text-xs leading-snug text-foreground" data-testid="auto-relay-armed">
          Авто-перенос включён — перенесу сам, когда чат разрастётся
        </p>
        {autoRelay && auto && <AutoRelaySwitch checked={auto.enabled} onChange={autoRelay.setEnabled} showLabel={false} />}
      </div>
    );
  }

  const busy = phase === 'collecting' || phase === 'creating';

  if (phase === 'collecting') {
    return (
      <Shell
        busy={busy}
        actions={(
          <>
            <Button size="sm" className="h-9 px-3" disabled>
              Перенести
            </Button>
            <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={relay.reset}>
              Отменить
            </Button>
          </>
        )}
      >
        <p className="text-sm text-foreground">Собираю записку…</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Агент пишет эстафету, потом откроется новый чат</p>
      </Shell>
    );
  }

  if (phase === 'creating') {
    return (
      <Shell
        busy={busy}
        actions={(
          <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={relay.reset}>
            Отменить
          </Button>
        )}
      >
        <p className="text-sm text-foreground">Открываю новый чат…</p>
      </Shell>
    );
  }

  if (phase === 'done') {
    return (
      <Shell
        busy={false}
        actions={(
          <>
            <Button size="sm" className="h-9 px-3" onClick={relay.openChild}>
              Открыть
            </Button>
            <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={relay.reset}>
              Закрыть
            </Button>
          </>
        )}
      >
        <p className="text-xs font-medium text-primary/80">Новый чат готов</p>
        <p className="mt-0.5 text-sm text-foreground">Записка передана, продолжение ждёт в новом чате</p>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell
        busy={false}
        actions={(
          <>
            <Button size="sm" className="h-9 px-3" onClick={relay.start}>
              Повторить
            </Button>
            <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={() => { relay.reset(); relay.dismiss(); }}>
              Закрыть
            </Button>
          </>
        )}
      >
        <p className="text-xs font-medium text-destructive">Перенос не удался</p>
        <p className="mt-0.5 break-words text-sm text-foreground">{error}</p>
      </Shell>
    );
  }

  return (
    <Shell
      busy={false}
      actions={(
        <>
          <Button size="sm" className="h-9 px-3" onClick={relay.start}>
            Перенести
          </Button>
          {autoMode !== 'armed' && (
            <Button size="sm" variant="ghost" className="h-9 px-3 text-muted-foreground" onClick={relay.dismiss}>
              Не сейчас
            </Button>
          )}
          {switchRow && <span className="ml-auto">{switchRow}</span>}
        </>
      )}
    >
      <p className="text-xs font-medium text-primary/80">{headline(relay)}</p>
      <p className="mt-0.5 text-sm text-foreground">
        {autoMode === 'armed'
          ? 'Авто-перенос включён — перенесу сам, как закончится следующий ход. Или перенеси сейчас'
          : 'Перенести в новый чат? Агент соберёт записку, новый чат её прочитает'}
      </p>
    </Shell>
  );
}

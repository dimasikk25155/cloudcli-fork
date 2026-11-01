import React, { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { GaugeIcon, ExternalLinkIcon } from 'lucide-react';

import { codexWindowLabel, getCodexLimits, refreshCodexLimits, subscribeCodexLimits } from '../../../../utils/codexUsageLimits';
import type { CodexLimits } from '../../../../utils/codexUsageLimits';
import { formatResetMoscow } from '../../../../utils/usageLimits';

const CHIP_CLASS = 'composer-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5';

export function CodexLimitsContent({ usage }: { usage: CodexLimits | null }) {
  return <>
    <div className="mb-2 font-semibold">Лимиты Codex{usage?.planType ? ` · ${usage.planType}` : ''}</div>
    {usage?.windows.length ? usage.windows.map((window, index) => (
      <div key={`${window.windowMinutes}:${index}`} className="mb-2 space-y-1">
        <div className="flex items-center justify-between gap-3">
          <span>Окно {codexWindowLabel(window.windowMinutes)}</span>
          <span className="font-medium">Использовано {Math.round(window.utilization)}%</span>
        </div>
        <div className="text-muted-foreground">Сброс: {formatResetMoscow(window.resetsAt, true)}</div>
      </div>
    )) : <div className="mb-2 text-muted-foreground">Данные о лимитах Codex недоступны.</div>}
    {usage && <div className="mb-2 text-muted-foreground">Обновлено: {formatResetMoscow(usage.fetchedAt)}</div>}
    <a className="text-primary hover:underline" href="https://chatgpt.com/codex/settings/usage" target="_blank" rel="noopener noreferrer">Открыть расход Codex</a>
  </>;
}

export default function CodexUsageLimitsBadge() {
  const usage = useSyncExternalStore(subscribeCodexLimits, getCodexLimits, getCodexLimits);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, bottom: 16 });
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const positionPanel = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - 304)), bottom: window.innerHeight - rect.top + 8 });
  }, []);
  useEffect(() => {
    void refreshCodexLimits();
    const timer = setInterval(() => { void refreshCodexLimits(); }, 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', positionPanel);
    document.addEventListener('scroll', positionPanel, true);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', positionPanel);
      document.removeEventListener('scroll', positionPanel, true);
    };
  }, [open, positionPanel]);
  const label = usage?.windows.length
    ? usage.windows.map((window) => `${codexWindowLabel(window.windowMinutes)} ${Math.round(window.utilization)}%`).join(' · ')
    : '—';
  return (
    <div ref={root} className="relative flex items-center gap-1">
      <button ref={trigger} type="button" className={CHIP_CLASS} aria-expanded={open} aria-controls={open ? panelId : undefined}
        aria-label={`Лимиты Codex: использовано ${label}. Показать подробности`}
        title={`Лимиты Codex: использовано ${label}`}
        onClick={() => { positionPanel(); setOpen((value) => !value); }}>
        <span className="composer-chip-icon grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary"><GaugeIcon className="h-3.5 w-3.5" /></span>
        <span className="font-medium tabular-nums">Codex · {label}</span>
      </button>
      <a href="https://chatgpt.com/codex/settings/usage" target="_blank" rel="noopener noreferrer"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Расход Codex в ChatGPT" aria-label="Открыть расход Codex в ChatGPT">
        <ExternalLinkIcon className="h-3.5 w-3.5" />
      </a>
      {open && createPortal(<div ref={panel} id={panelId} role="dialog" aria-label="Лимиты Codex" style={position} className="fixed z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
        <CodexLimitsContent usage={usage} />
      </div>, document.body)}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TimerIcon } from 'lucide-react';

import {
  getPromptCacheTtlMin,
  promptCacheChipLabel,
  promptCacheCompactLabel,
  promptCacheExplanation,
  promptCacheStatus,
  type PromptCacheState,
} from '../../../../utils/promptCache';

import { CHIP_METER, CHIP_METER_ICON_SHAPE } from './composerChips';

/** Re-render often enough that the minute counter never lags by a whole minute. */
const TICK_MS = 15_000;

const TONE: Record<PromptCacheState, string> = {
  unknown: 'text-muted-foreground',
  running: 'text-muted-foreground',
  warm: 'text-foreground',
  cooling: 'text-warning',
  cold: 'text-destructive',
};

const ICON_TONE: Record<PromptCacheState, string> = {
  unknown: 'text-primary',
  running: 'text-primary',
  warm: 'text-primary',
  cooling: 'text-warning',
  cold: 'text-destructive',
};

type Props = {
  /** Epoch ms of the session's last model output; null = unknown. */
  lastModelAt: number | null;
  /** A turn is running right now. */
  isRunning: boolean;
  /** Override for tests/stands; default — the server's TTL. */
  ttlMin?: number;
  /**
   * `compact` = phone form pinned left of the scrolling chip row, always in
   * view: «⏱ 42м», a cold cache is a red dot + «остыл».
   */
  variant?: 'full' | 'compact';
  className?: string;
};

const POPOVER_WIDTH = 256;
const VIEWPORT_MARGIN = 8;

const timeOf = (at: number) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/**
 * «Кэш 42 мин» chip next to «Контекст» and «5ч/7д»: minutes left before
 * Anthropic drops this chat's prompt cache. Counted from the last model
 * output, never from the send button. Hover = tooltip, tap = the same
 * explanation in a popover (phones have no hover). Claude sessions only —
 * the composer decides that; this chip just renders the status.
 */
export default function PromptCacheChip({ lastModelAt, isRunning, ttlMin, variant = 'full', className = '' }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  // The chip row scrolls horizontally (it clips anything absolute), so the
  // popover is portalled to <body> and pinned above the chip.
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const ttl = ttlMin ?? getPromptCacheTtlMin();
  const status = promptCacheStatus({ lastModelAt, isRunning, now, ttlMin: ttl });
  const label = promptCacheChipLabel(status);
  const compactLabel = promptCacheCompactLabel(status);
  const isCompact = variant === 'compact';

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [lastModelAt, isRunning]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
      setAnchor({
        left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
        bottom: window.innerHeight - rect.top + VIEWPORT_MARGIN,
      });
    }
    setOpen(true);
  };

  if (!label) {
    return null;
  }

  const explanation = promptCacheExplanation(ttl);
  const detail = status.state === 'running'
    ? 'Идёт ход — каждый запрос к модели продлевает кэш.'
    : lastModelAt !== null && status.expiresAt !== null
      ? status.state === 'cold'
        ? `Последний ответ модели в ${timeOf(lastModelAt)}, кэш остыл в ${timeOf(status.expiresAt)}.`
        : `Последний ответ модели в ${timeOf(lastModelAt)}, кэш остынет в ${timeOf(status.expiresAt)}.`
      : null;
  const title = [label, detail, explanation].filter(Boolean).join('\n');

  return (
    <div ref={rootRef} className={`relative ${className}`} data-prompt-cache={status.state} data-prompt-cache-variant={variant}>
      <button
        type="button"
        onClick={toggle}
        className={CHIP_METER}
        title={title}
        aria-label={`${label}. Что это значит`}
        aria-expanded={open}
      >
        {isCompact && status.state === 'cold' ? (
          <span aria-hidden className="h-2 w-2 rounded-full bg-destructive" />
        ) : (
          <TimerIcon aria-hidden className={`${CHIP_METER_ICON_SHAPE} ${ICON_TONE[status.state]}`} />
        )}
        <span className={`whitespace-nowrap font-medium tabular-nums ${TONE[status.state]}`}>{isCompact ? compactLabel : label}</span>
      </button>
      {open && anchor && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Кэш разговора"
          style={{ left: anchor.left, bottom: anchor.bottom, width: POPOVER_WIDTH }}
          className="fixed z-[200] max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg"
        >
          <p className={`mb-1 font-medium ${TONE[status.state]}`}>{label}</p>
          {detail && <p className="mb-1.5 text-muted-foreground">{detail}</p>}
          <p>{explanation}</p>
        </div>,
        document.body,
      )}
    </div>
  );
}

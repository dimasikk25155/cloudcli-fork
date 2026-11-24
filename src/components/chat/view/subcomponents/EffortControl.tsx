import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brain, RotateCcw } from 'lucide-react';

import type { ProviderModelOption } from '../../../../types/app';

import { CHIP_ICONIC, ChipLabel } from './composerChips';


type Props = {
  modelLabel: string;
  effort: string;
  defaultEffort?: string;
  options: NonNullable<ProviderModelOption['effort']>['values'];
  onSelect: (effort: string) => void;
};

const LEVEL_NAMES: Record<string, string> = {
  none: 'Без размышления', minimal: 'Минимальный', low: 'Лёгкий',
  medium: 'Средний', high: 'Высокий', xhigh: 'Очень высокий',
  max: 'Максимальный', ultra: 'Ультра',
};

export default function EffortControl({ modelLabel, effort, defaultEffort, options, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const popupId = useId();
  const effective = options.some(option => option.value === effort) ? effort : defaultEffort;
  const index = options.findIndex(option => option.value === effective);
  const label = effective ? LEVEL_NAMES[effective] ?? effective : 'Размышление';

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      const panel = popup.current?.getBoundingClientRect();
      if (!rect || !panel) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      const top = rect.top - panel.height - 8 >= topEdge
        ? rect.top - panel.height - 8 : rect.bottom + 8;
      setPosition({
        left: Math.max(leftEdge, Math.min(rect.left, rightEdge - panel.width)),
        top: Math.max(topEdge, Math.min(top, bottomEdge - panel.height)),
      });
    };
    place();
    slider.current?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      anchor.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  // No generic provider fallback: every position must be supported by this model.
  if (options.length < 2 || index < 0) return null;

  return <>
    {/* На телефоне от кнопки остаётся значок: уровень назван в aria-label и
        в окне по нажатию. Значок — не молния: она у режима работы. */}
    <button ref={anchor} type="button" className={`${CHIP_ICONIC} composer-chip-effort`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined}
      aria-label={`Уровень размышления: ${label}`} title="Уровень размышления"
      onClick={() => setOpen(value => !value)}>
      <Brain size={16} aria-hidden="true" /><ChipLabel>{label}</ChipLabel>
    </button>
    {open && createPortal(
      <div ref={popup} id={popupId} role="dialog" aria-label={`Размышление — ${modelLabel}`}
        className="glass-surface glass-dense effort-popup" style={position}>
        <div className="effort-popup-heading">
          <Brain size={15} aria-hidden="true" className="effort-popup-icon" />
          <div className="effort-popup-titles">
            <div className="effort-popup-level" aria-live="polite">{label}</div>
            <div className="effort-popup-model" title={modelLabel}>{modelLabel}</div>
          </div>
          <button type="button" className="effort-popup-reset" aria-label="Сбросить уровень по умолчанию"
            title={`По умолчанию: ${LEVEL_NAMES[defaultEffort ?? ''] ?? defaultEffort}`}
            onClick={() => onSelect('default')}><RotateCcw size={15} aria-hidden="true" /></button>
        </div>
        <div className="effort-slider-wrap">
          <div className="effort-slider-dots" aria-hidden="true">
            {options.map(option => <i key={option.value} />)}
          </div>
          <input ref={slider} type="range" min={0} max={options.length - 1} step={1} value={index}
            aria-label="Уровень размышления" aria-valuetext={label}
            onChange={event => onSelect(options[Number(event.target.value)].value)} />
        </div>
      </div>, document.body,
    )}
  </>;
}

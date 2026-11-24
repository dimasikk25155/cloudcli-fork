import React from 'react';
import type { ReactNode } from 'react';
import { Gauge, HelpCircle, ListChecks, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { WorkMode } from '../../types/types';

/*
 * Кнопки и показания ряда поля ввода — общие имена классов для ChatComposer,
 * EffortControl и чипов с процентом. Материал дают классы стекла, размеры и
 * раскладку — раздел «Поле ввода чата» в index.css.
 */

/** Круг: вложение, режим разрешений, голос. */
export const CHIP_ROUND = 'composer-chip glass-button touch-manipulation text-foreground';

/** Пилюля со значком и подписью: режим работы, модель, уровень размышления. */
export const CHIP_PILL = 'composer-chip glass-pill touch-manipulation font-medium text-foreground';

/**
 * Пилюля, у которой на телефоне остаётся только значок: подпись лежит в
 * `ChipLabel`, узкое поле ввода её прячет и сжимает пилюлю до круга.
 */
export const CHIP_ICONIC = `${CHIP_PILL} composer-chip-iconic`;

/** Показание со значком и числом (лимиты, контекст, кэш) — видно целиком всегда. */
export const CHIP_METER = 'composer-chip composer-meter glass-pill touch-manipulation';

/** Значок показания без цвета — когда цвет несёт состояние (кэш остывает). */
export const CHIP_METER_ICON_SHAPE = 'composer-chip-icon h-3.5 w-3.5';

/** Значок показания: цвет акцента темы, без своей плашки. */
export const CHIP_METER_ICON = `${CHIP_METER_ICON_SHAPE} text-primary`;

/** Меню кнопки поля ввода: плотная карточка стекла поверх переписки. */
export const CHIP_MENU = 'glass-surface glass-dense fixed z-[100] overflow-y-auto rounded-2xl p-1.5 text-popover-foreground';

/** Пункт такого меню: 44px под палец на телефоне, плотнее с мышью. */
export const chipMenuItem = (selected: boolean) =>
  `flex min-h-11 w-full touch-manipulation gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors md:min-h-0 md:py-1.5 md:text-xs ${
    selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
  }`;

// Режим работы — переключатель поведения, не уровень риска, поэтому у него
// значок, а не цветная точка режима разрешений. У «Обычного» — молния: на
// телефоне от кнопки остаётся один значок, и он должен читаться как «просто
// работай» (Дима, 23.11). Уровню размышления молния поэтому не достаётся.
export const WORK_MODE_ICON: Record<WorkMode, LucideIcon> = {
  autopilot: Zap,
  checkpoints: ListChecks,
  interrogate: HelpCircle,
  // Та же шкала, что на вкладке дашборда — режим и его экран узнаются вместе.
  build: Gauge,
};

// Точка и подцветка кнопки по режиму разрешений — одна легенда для кнопки и
// пунктов её меню. Шкала: серый — спрашивает обо всём, цвет «информации» —
// ничего не трогает (план), цвет «предупреждения» — не спрашивает ни о чём
// (обход); план с автозапуском стоит между ними и носит оба цвета. Цвета —
// статусы темы, поэтому в каждой теме свои.
export const PERMISSION_MODE_TONE: Record<string, { dot: string; button: string }> = {
  default: { dot: 'bg-muted-foreground', button: '' },
  plan: { dot: 'bg-info', button: 'border-info/50 bg-info/10' },
  bypassPermissions: { dot: 'bg-warning', button: 'border-warning/50 bg-warning/10' },
  planBypass: { dot: 'bg-gradient-to-r from-info to-warning', button: 'border-warning/50 bg-info/10' },
};

const UNKNOWN_MODE_TONE = { dot: 'bg-primary', button: 'border-primary/40 bg-primary/10' };

export const permissionModeTone = (mode: string) => PERMISSION_MODE_TONE[mode] ?? UNKNOWN_MODE_TONE;

/** Подпись чипа, которую узкое поле ввода прячет (`.composer-chip-label`). */
export function ChipLabel({ children }: { children: ReactNode }) {
  return <span className="composer-chip-label">{children}</span>;
}

/** Содержимое кнопки режима работы: значок и прячущаяся подпись. */
export function WorkModeFace({ mode, label }: { mode: WorkMode; label: string }) {
  const Icon = WORK_MODE_ICON[mode];
  return (
    <>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <ChipLabel>{label}</ChipLabel>
    </>
  );
}

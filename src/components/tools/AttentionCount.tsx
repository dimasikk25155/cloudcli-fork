import React from 'react';

import { cn } from '../../lib/utils';

type AttentionCountProps = {
  /** Сколько дел «Канцелярии» горит; ноль — ничего не рисуется. */
  count: number;
  className?: string;
};

/**
 * Красный счётчик «Канцелярии»: просроченное и ближайшие три дня. Один вид
 * везде, где он стоит, — строка «Канцелярия», вкладка «Инструменты», кнопка
 * «Настройки» в нижней панели и внизу шторки. Цвет — значение темы.
 */
export default function AttentionCount({ count, className }: AttentionCountProps) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'pointer-events-none flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground',
        className,
      )}
      data-attention-count={count}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

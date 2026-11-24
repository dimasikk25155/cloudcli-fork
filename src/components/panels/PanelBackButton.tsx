import React from 'react';
import { ChevronLeft } from 'lucide-react';

import { cn } from '../../lib/utils';

/**
 * «Назад» for full-screen windows on a phone: an arrow on the left of the
 * header that closes the window. On an iPhone there is no Esc and no visible
 * backdrop to tap, and the cross on the right sat under the clock — Dima had
 * no way out of Канцелярия, Задачи, «Ждут тебя» (23.11). From `md` up the
 * window is a centred card with its cross, so the arrow is hidden there.
 */
export default function PanelBackButton({
  onClick,
  className,
  label = 'Назад',
}: {
  onClick: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        // Круглая стеклянная кнопка. 36 px box, 44 px to the finger (Apple's
        // minimum touch target) without a bigger look: the invisible ::before
        // of `.glass-button` grows the touch area, measured from the box
        // inside the 1 px rim — no utility here may override it.
        'glass-button relative h-9 w-9 flex-shrink-0 touch-manipulation text-foreground md:hidden',
        className,
      )}
    >
      <ChevronLeft className="h-5 w-5" aria-hidden />
    </button>
  );
}

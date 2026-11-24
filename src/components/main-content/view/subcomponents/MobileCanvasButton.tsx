import React from 'react';
import { PanelRightOpen } from 'lucide-react';

/**
 * «Холст» в шапке чата на телефоне (мод «Рабочий стол»): круглая стеклянная
 * кнопка, открывает холст поверх чата. На компьютере в шапке стоит
 * `WorkbenchToggle` — переключатель с подписью.
 */
export default function MobileCanvasButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Открыть холст"
      aria-label="Открыть холст"
      className="glass-button h-9 w-9 flex-shrink-0 touch-manipulation text-foreground"
      data-workbench-toggle
    >
      <PanelRightOpen className="h-[1.125rem] w-[1.125rem]" aria-hidden />
    </button>
  );
}

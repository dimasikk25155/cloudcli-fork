import React from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

type WorkbenchToggleProps = {
  /** Desktop: the canvas is shown next to the chat. */
  active: boolean;
  onClick: () => void;
  /** Phone (≤768 px): «Холст» opens the canvas over the chat. */
  isMobile: boolean;
};

/** «Рабочий стол» switch in the chat header (mod `modWorkbench`). */
export default function WorkbenchToggle({ active, onClick, isMobile }: WorkbenchToggleProps) {
  const label = isMobile ? 'Холст' : 'Рабочий стол';
  const Icon = active && !isMobile ? PanelRightClose : PanelRightOpen;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isMobile ? undefined : active}
      title={isMobile ? 'Открыть холст' : active ? 'Убрать рабочий стол' : 'Рабочий стол: холст рядом с чатом'}
      className={`inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors ${
        active && !isMobile ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-accent hover:text-foreground'
      }`}
      data-workbench-toggle
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span className={isMobile ? '' : 'hidden lg:inline'}>{label}</span>
    </button>
  );
}

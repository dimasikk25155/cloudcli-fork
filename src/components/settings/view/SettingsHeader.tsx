import React from 'react';
import { X } from 'lucide-react';

import { Button } from '../../../shared/view/ui';
import PanelBackButton from '../../panels/PanelBackButton';

/**
 * Header of the Settings window. On a phone the window fills the screen, so
 * the way out is «Назад» on the left, as in every other panel; the cross is
 * for the centred desktop card.
 */
export default function SettingsHeader({
  title,
  onClose,
  savedText,
}: {
  title: string;
  onClose: () => void;
  /** Short «saved» note next to the cross; nothing when absent. */
  savedText?: string;
}) {
  return (
    <div className="pwa-settings-header flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3 md:px-5">
      <div className="flex min-w-0 items-center gap-1">
        <PanelBackButton onClick={onClose} />
        <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
      </div>
      <div className="flex items-center gap-2">
        {savedText && (
          <span className="animate-in fade-in text-xs text-muted-foreground">{savedText}</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Закрыть"
          className="hidden h-10 w-10 touch-manipulation p-0 text-muted-foreground hover:text-foreground active:bg-accent/50 md:inline-flex"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

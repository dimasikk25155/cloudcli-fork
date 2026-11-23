import React from 'react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { SessionSortOrder } from '../../types/types';

/**
 * «Новые / Недавние» — order of chats inside every project. «Новые» is the
 * creation order (plus drag order), «Недавние» puts first the chat Dima last
 * wrote in; the agent's replies do not move a chat (server `lastPromptAt`).
 * Replaces the old «Недавние» tab (23.11, Dima's voice note).
 */
export default function SessionSortToggle({
  order,
  onChange,
  t,
}: {
  order: SessionSortOrder;
  onChange: (order: SessionSortOrder) => void;
  t: TFunction;
}) {
  // Same 24 px pill as the project switch, 44 px to the finger on a phone.
  const segment = (active: boolean, side: 'left' | 'right') => cn(
    'relative flex h-6 touch-manipulation items-center justify-center whitespace-nowrap rounded-full px-2 text-[11px] font-medium leading-none transition-colors',
    'max-md:before:absolute max-md:before:-inset-y-2.5',
    side === 'left' ? 'max-md:before:-left-3 max-md:before:right-0' : 'max-md:before:-right-3 max-md:before:left-0',
    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
  );
  const createdLabel = t('sessionSort.created', 'Новые');
  const promptLabel = t('sessionSort.prompt', 'Недавние');

  return (
    <div
      role="group"
      aria-label={t('sessionSort.label', 'Порядок чатов')}
      className="flex flex-shrink-0 items-center rounded-full bg-muted/60 p-0.5"
      data-session-sort={order}
    >
      <button
        type="button"
        onClick={() => onChange('created')}
        aria-pressed={order === 'created'}
        title={t('sessionSort.createdHint', 'Чаты по дате создания — новые сверху')}
        className={segment(order === 'created', 'left')}
      >
        {createdLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange('prompt')}
        aria-pressed={order === 'prompt'}
        title={t('sessionSort.promptHint', 'Сверху чат, где ты писал последним')}
        className={segment(order === 'prompt', 'right')}
      >
        {promptLabel}
      </button>
    </div>
  );
}

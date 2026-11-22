import React from 'react';
import { Clock3 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { ProjectSortOrder } from '../../types/types';

/**
 * Small «Недавние / А–Я» switch next to the «Проекты» tab. The recent side
 * is a clock, not the word: the neighbouring tab is already called «Недавние».
 */
export default function ProjectSortToggle({
  order,
  onChange,
  t,
}: {
  order: ProjectSortOrder;
  onChange: (order: ProjectSortOrder) => void;
  t: TFunction;
}) {
  // A 24 px pill, but 44 px to the finger on a phone (review 23.11): an
  // invisible ::before 10 px above and below, 16 px outward — left of the
  // clock, right of А–Я — so the two areas never overlap each other.
  const segment = (active: boolean, side: 'left' | 'right') => cn(
    'relative flex h-6 min-w-[1.75rem] touch-manipulation items-center justify-center rounded-full px-1.5 text-[11px] font-medium leading-none transition-colors',
    'max-md:before:absolute max-md:before:-inset-y-2.5',
    side === 'left' ? 'max-md:before:-left-4 max-md:before:right-0' : 'max-md:before:-right-4 max-md:before:left-0',
    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
  );
  const recentLabel = t('projectSort.recent', 'Recent first');
  const nameLabel = t('projectSort.name', 'Alphabetical');

  return (
    <div
      role="group"
      aria-label={t('projectSort.label', 'Project order')}
      className="flex flex-shrink-0 items-center rounded-full bg-muted/60 p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange('recent')}
        aria-label={recentLabel}
        aria-pressed={order === 'recent'}
        title={recentLabel}
        className={segment(order === 'recent', 'left')}
      >
        <Clock3 className="h-3 w-3" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onChange('name')}
        aria-label={nameLabel}
        aria-pressed={order === 'name'}
        title={nameLabel}
        className={segment(order === 'name', 'right')}
      >
        А–Я
      </button>
    </div>
  );
}

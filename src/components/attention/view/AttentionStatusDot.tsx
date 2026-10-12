import React from 'react';

import { cn } from '../../../lib/utils';
import type { AttentionItem } from '../types';
import { describeAttention, type AttentionTone } from '../utils/attentionModel';

/**
 * Theme-token colour per status. Waiting pulses (it blocks the agent);
 * finished states stay still so the eye goes to the blocker first.
 */
const ATTENTION_TONE_DOT: Record<AttentionTone, string> = {
  waiting: 'bg-warning animate-pulse',
  failed: 'bg-destructive',
  done: 'bg-info',
  working: 'bg-success',
};

type AttentionStatusDotProps = {
  item: AttentionItem;
  className?: string;
};

/** Small coloured status dot with the status caption as aria-label and title. */
export default function AttentionStatusDot({ item, className }: AttentionStatusDotProps) {
  const { tone, statusLabel } = describeAttention(item);
  return (
    <span
      role="img"
      aria-label={statusLabel}
      title={statusLabel}
      data-attention-state={item.state}
      className={cn('inline-block h-2 w-2 flex-shrink-0 rounded-full', ATTENTION_TONE_DOT[tone], className)}
    />
  );
}

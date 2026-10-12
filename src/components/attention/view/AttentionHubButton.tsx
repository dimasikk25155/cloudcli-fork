import { Bell, BellRing } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { useAttention } from '../useAttention';

type AttentionHubButtonProps = {
  onClick: () => void;
  /** `compact` = desktop header / collapsed rail, `touch` = mobile header. */
  variant?: 'compact' | 'touch';
};

/** Header button of the «Ждут тебя» hub with the N counter. */
export default function AttentionHubButton({ onClick, variant = 'compact' }: AttentionHubButtonProps) {
  const { total, counts } = useAttention();
  const Icon = counts.waiting > 0 ? BellRing : Bell;
  const label = total > 0 ? `Ждут тебя: ${total}` : 'Ждут тебя';
  const badgeText = total > 99 ? '99+' : String(total);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'relative flex flex-shrink-0 items-center justify-center rounded-lg transition-all',
        variant === 'touch'
          ? 'h-8 w-8 bg-muted/50 active:scale-95'
          : 'h-7 w-7 text-muted-foreground hover:bg-accent/80 hover:text-foreground',
      )}
    >
      <Icon className={cn(variant === 'touch' ? 'h-4 w-4' : 'h-3.5 w-3.5', 'text-muted-foreground', counts.waiting > 0 && 'text-warning')} />
      {total > 0 && (
        <span
          aria-hidden
          className={cn(
            'absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none',
            counts.waiting > 0 ? 'bg-warning text-warning-foreground' : 'bg-primary text-primary-foreground',
          )}
        >
          {badgeText}
        </span>
      )}
    </button>
  );
}

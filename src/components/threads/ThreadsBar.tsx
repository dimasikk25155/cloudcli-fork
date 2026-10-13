import { useState } from 'react';
import { ChevronDown, GitBranch } from 'lucide-react';

import type { SessionLinks } from '../../../shared/session-links';
import { cn } from '../../lib/utils';
import { useAttention } from '../attention/useAttention';

import { buildThreadsBar, type ThreadBarState } from './threadsBarModel';

const STATE_DOT: Record<ThreadBarState, string> = {
  working: 'bg-success animate-pulse',
  waiting: 'bg-warning animate-pulse',
  failed: 'bg-destructive',
  done: 'bg-info',
  idle: 'bg-muted-foreground/50',
};

type ThreadsBarProps = {
  links: SessionLinks | undefined;
  onOpenThread: (sessionId: string) => void;
  unnamedLabel?: string;
};

/**
 * «Треды: N (работают M)» over the chat of a parent whose agent opened
 * threads (neo3-threads MCP). Tap opens the list; a row opens that thread.
 * Hidden when the chat has no threads.
 */
export default function ThreadsBar({ links, onOpenThread, unnamedLabel }: ThreadsBarProps) {
  const { byId } = useAttention();
  const [open, setOpen] = useState(false);
  const bar = buildThreadsBar(links, byId, unnamedLabel);
  if (!bar) {
    return null;
  }

  return (
    <div className="flex-shrink-0 border-b border-border/50 bg-card/90 px-3 backdrop-blur-sm py-1.5 text-xs" data-threads-bar>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-[32px] w-full items-center gap-2 rounded-md px-1 text-left text-muted-foreground hover:text-foreground"
      >
        <GitBranch className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        <span className="font-medium text-foreground">{bar.label}</span>
        {bar.working > 0 && <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" aria-hidden />}
        <ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-0.5 pb-1">
          {bar.items.map((item) => (
            <li key={item.sessionId}>
              <button
                type="button"
                onClick={() => onOpenThread(item.sessionId)}
                className="flex min-h-[36px] w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent"
              >
                <span className={cn('inline-block h-2 w-2 flex-shrink-0 rounded-full', STATE_DOT[item.state])} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
                <span className="flex-shrink-0 text-[11px] text-muted-foreground">{item.provider} · {item.stateLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import React from 'react';
import type { ReactNode } from 'react';
import { CheckCheck, Inbox } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { Button } from '../../../shared/view/ui/Button';
import type { AttentionItem } from '../types';
import {
  countAttention,
  describeAttention,
  groupAttention,
  type AttentionGroupKey,
} from '../utils/attentionModel';

import AttentionStatusDot from './AttentionStatusDot';

/**
 * An extra block of the hub below the status groups. The status groups are
 * built in; other features plug in here (e.g. «Заметки в вольт» — task 07)
 * without touching the hub itself.
 */
export type AttentionHubSection = {
  id: string;
  title: string;
  /** Optional counter shown next to the title. */
  count?: number;
  render: () => ReactNode;
};

export type AttentionHubViewProps = {
  items: readonly AttentionItem[];
  nowMs?: number;
  onOpenSession: (item: AttentionItem) => void;
  onMarkAllSeen: () => void;
  extraSections?: readonly AttentionHubSection[];
  /** Engine mark next to the name (logos are injected by the app shell). */
  renderProviderMark?: (provider: string) => ReactNode;
  /** Engine display name — the app shell passes the sidebar's i18n labels. */
  getProviderLabel?: (provider: string) => string;
};

const rawProviderLabel = (provider: string) => provider;

const GROUP_ACCENT: Record<AttentionGroupKey, string> = {
  waiting: 'text-warning',
  failed: 'text-destructive',
  done: 'text-info',
  working: 'text-success',
};

function SectionHeader({ title, count, accent }: { title: string; count?: number; accent?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-1.5">
      <h3 className={cn('text-xs font-medium uppercase tracking-wide text-muted-foreground', accent)}>{title}</h3>
      {typeof count === 'number' && <span className="text-[11px] text-muted-foreground/70">{count}</span>}
    </div>
  );
}

function AttentionRow({
  item,
  nowMs,
  onOpen,
  renderProviderMark,
  getProviderLabel,
}: {
  item: AttentionItem;
  nowMs: number;
  onOpen: (item: AttentionItem) => void;
  renderProviderMark?: (provider: string) => ReactNode;
  getProviderLabel: (provider: string) => string;
}) {
  const { statusLabel, ageLabel, summary } = describeAttention(item, nowMs);
  const title = item.title?.trim() || 'Без названия';
  const meta = [item.projectName, getProviderLabel(item.provider), statusLabel].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      data-attention-row={item.sessionId}
      onClick={() => onOpen(item)}
      className="flex w-full min-w-0 items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none active:bg-accent/60"
    >
      <AttentionStatusDot item={item} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {renderProviderMark?.(item.provider)}
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</span>
          <span className="flex-shrink-0 text-[11px] text-muted-foreground">{ageLabel}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        {summary && <p className="mt-0.5 truncate text-xs text-foreground/80">{summary}</p>}
      </div>
    </button>
  );
}

/** Body of the «Ждут тебя» hub: status groups, empty state, extra sections. */
export default function AttentionHubView({
  items,
  nowMs = Date.now(),
  onOpenSession,
  onMarkAllSeen,
  extraSections = [],
  renderProviderMark,
  getProviderLabel = rawProviderLabel,
}: AttentionHubViewProps) {
  const groups = groupAttention(items);
  const { total, counts } = countAttention(items);
  const canMarkAllSeen = counts.failed + counts.unreadDone > 0;

  return (
    <div className="space-y-4 px-3 py-3">
      {groups.length > 0 && (
        <div className="flex min-h-9 items-center justify-between gap-3 px-1">
          <p className="text-sm text-muted-foreground">
            {total > 0 ? `Требуют тебя: ${total}` : 'Сейчас всё идёт само'}
          </p>
          {canMarkAllSeen && (
            <Button variant="ghost" size="sm" className="h-9 flex-shrink-0 gap-1.5 px-2.5" onClick={onMarkAllSeen}>
              <CheckCheck className="h-4 w-4" />
              Всё просмотрено
            </Button>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="px-4 py-12 text-center md:py-10">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-muted/50 md:mb-3">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mb-1 text-base font-medium text-foreground">Никто тебя не ждёт</h3>
          <p className="text-sm text-muted-foreground">Когда агент спросит или закончит, он появится здесь.</p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-label={group.title}>
            <SectionHeader title={group.title} count={group.items.length} accent={GROUP_ACCENT[group.key]} />
            <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-sm">
              {group.items.map((entry) => (
                <AttentionRow
                  key={entry.sessionId}
                  item={entry}
                  nowMs={nowMs}
                  onOpen={onOpenSession}
                  renderProviderMark={renderProviderMark}
                  getProviderLabel={getProviderLabel}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {extraSections.map((section) => (
        <section key={section.id} aria-label={section.title}>
          <SectionHeader title={section.title} count={section.count} />
          {section.render()}
        </section>
      ))}
    </div>
  );
}

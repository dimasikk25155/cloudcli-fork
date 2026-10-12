import { useState } from 'react';
import { BookMarked, Check, Loader2, XIcon } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { Button } from '../../../shared/view/ui/Button';

import type { MemoryEntry } from './memorySuggestionsStore';

type MemorySuggestionCardProps = {
  entry: MemoryEntry;
  onWrite: (id: number) => void;
  onDismiss: (id: number) => void;
  /** Hub: show which session the note comes from and let it be opened. */
  context?: { label: string; onOpen?: () => void } | null;
  className?: string;
};

/**
 * «Агент предлагает заметку: <заголовок>» — «Записать» / «Посмотреть» / «Не надо».
 * After «Записать» the card shows where the note went until it is closed.
 * Same card in the session (over the composer) and in the hub.
 */
export default function MemorySuggestionCard({ entry, onWrite, onDismiss, context, className }: MemorySuggestionCardProps) {
  const [showBody, setShowBody] = useState(false);
  const { suggestion, writtenPath, busy, error } = entry;
  const written = Boolean(writtenPath);

  return (
    <div
      className={cn('settings-content-enter rounded-xl border border-primary/25 bg-primary/[0.04] px-3 py-2.5', className)}
      data-testid="memory-suggestion"
    >
      <div className="flex items-start gap-2.5">
        <BookMarked aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-primary/80">
            {written ? 'Заметка записана' : 'Агент предлагает заметку'}
          </p>
          <p className="mt-0.5 break-words text-sm text-foreground">{suggestion.title}</p>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0 font-mono text-[11px]">{suggestion.folder}</span>
            {context && <span aria-hidden>·</span>}
            {context && (
              context.onOpen ? (
                <button
                  type="button"
                  onClick={context.onOpen}
                  className="min-w-0 truncate text-left underline-offset-2 hover:text-foreground hover:underline"
                >
                  {context.label}
                </button>
              ) : (
                <span className="min-w-0 truncate">{context.label}</span>
              )
            )}
          </div>
        </div>
        {written && (
          <button
            type="button"
            onClick={() => onDismiss(suggestion.id)}
            aria-label="Закрыть"
            title="Закрыть"
            className="-mr-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {written ? (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-foreground/90">
          <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <code className="min-w-0 select-all break-all font-mono text-[11px] leading-relaxed" data-testid="memory-written-path">
            {writtenPath}
          </code>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" className="h-9 gap-1.5 px-3" onClick={() => onWrite(suggestion.id)} disabled={busy !== null}>
            {busy === 'write' && <Loader2 className="animate-spin" />}
            Записать
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 px-3"
            aria-expanded={showBody}
            onClick={() => setShowBody((value) => !value)}
          >
            {showBody ? 'Скрыть' : 'Посмотреть'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 px-3 text-muted-foreground"
            onClick={() => onDismiss(suggestion.id)}
            disabled={busy !== null}
          >
            {busy === 'dismiss' && <Loader2 className="animate-spin" />}
            Не надо
          </Button>
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}

      {showBody && !written && (
        <pre
          className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-background/70 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90"
          data-testid="memory-suggestion-body"
        >
          {suggestion.body}
        </pre>
      )}
    </div>
  );
}

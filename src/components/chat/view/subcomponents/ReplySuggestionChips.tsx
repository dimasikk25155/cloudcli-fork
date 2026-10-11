import { PencilIcon } from 'lucide-react';

type ReplySuggestionChipsProps = {
  suggestions: string[];
  /** Tap on the chip: send right away (same path as Enter). */
  onSend: (text: string) => void;
  /** Pencil: put the text into the field to edit first. */
  onEdit: (text: string) => void;
};

/**
 * 2–3 ready answers over the composer after a turn that ended with a question
 * or a request. Visibility is decided by the composer; this only draws them.
 */
export default function ReplySuggestionChips({ suggestions, onSend, onEdit }: ReplySuggestionChipsProps) {
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <div
      className="settings-content-enter mx-auto mb-2 flex max-w-[54.25rem] flex-wrap gap-1.5"
      role="group"
      aria-label="Быстрые ответы"
      data-testid="reply-suggestion-chips"
    >
      {suggestions.map((text) => (
        <div
          key={text}
          className="flex min-w-0 max-w-full items-stretch overflow-hidden rounded-full border border-primary/25 bg-primary/[0.06] text-foreground shadow-sm"
        >
          <button
            type="button"
            onClick={() => onSend(text)}
            aria-label={`Отправить: ${text}`}
            className="min-h-[36px] min-w-0 truncate py-1.5 pl-3.5 pr-2 text-left text-sm transition-colors hover:bg-primary/10 active:bg-primary/15"
          >
            {text}
          </button>
          <button
            type="button"
            onClick={() => onEdit(text)}
            aria-label={`Поправить перед отправкой: ${text}`}
            title="Поправить перед отправкой"
            className="flex min-h-[36px] shrink-0 items-center border-l border-primary/15 px-2.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
          >
            <PencilIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

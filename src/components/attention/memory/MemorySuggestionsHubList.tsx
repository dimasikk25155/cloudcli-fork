import MemorySuggestionCard from './MemorySuggestionCard';
import type { MemoryEntry } from './memorySuggestionsStore';

type MemorySuggestionsHubListProps = {
  entries: readonly MemoryEntry[];
  onWrite: (id: number) => void;
  onDismiss: (id: number) => void;
  onOpenSession?: (sessionId: string) => void;
};

/** «Заметки в вольт» block of the hub: one card per proposed note. */
export default function MemorySuggestionsHubList({ entries, onWrite, onDismiss, onOpenSession }: MemorySuggestionsHubListProps) {
  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const { suggestion } = entry;
        const label = [suggestion.projectName, suggestion.sessionTitle?.trim() || 'Без названия'].filter(Boolean).join(' · ');
        return (
          <MemorySuggestionCard
            key={suggestion.id}
            entry={entry}
            onWrite={onWrite}
            onDismiss={onDismiss}
            context={{ label, onOpen: onOpenSession ? () => onOpenSession(suggestion.sessionId) : undefined }}
          />
        );
      })}
    </div>
  );
}

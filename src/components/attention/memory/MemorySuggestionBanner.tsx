import MemorySuggestionCard from './MemorySuggestionCard';
import { useSessionMemorySuggestions } from './useMemorySuggestions';

/** Proposed vault note of the open session, over the composer (admins only). */
export default function MemorySuggestionBanner({ sessionId }: { sessionId: string | null | undefined }) {
  const { entries, write, dismiss } = useSessionMemorySuggestions(sessionId);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="mx-auto mb-2 max-w-[54.25rem] space-y-2">
      {entries.map((entry) => (
        <MemorySuggestionCard
          key={entry.suggestion.id}
          entry={entry}
          onWrite={(id) => void write(id)}
          onDismiss={(id) => void dismiss(id)}
        />
      ))}
    </div>
  );
}

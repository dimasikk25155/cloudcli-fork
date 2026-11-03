/** Human-readable wall duration of one completed run. */
export function formatCompletionDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return [hours ? `${hours} ч` : '', minutes ? `${minutes} мин` : '', `${seconds} сек`]
    .filter(Boolean).join(' ');
}

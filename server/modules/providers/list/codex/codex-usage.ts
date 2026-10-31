/** Codex input includes cached tokens; the common meter expects fresh input. */
export function codexMeterMessage(usage: Record<string, unknown> | null | undefined, model: string, id?: string) {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  const total = number(usage?.input_tokens);
  const cached = Math.min(total, number(usage?.cached_input_tokens));
  return {
    id, model,
    usage: {
      input_tokens: total - cached,
      cache_read_input_tokens: cached,
      output_tokens: number(usage?.output_tokens),
    },
  };
}

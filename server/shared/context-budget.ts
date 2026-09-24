/** Occupancy snapshots, deliberately independent of cumulative billing counters. */
type Row = Record<string, any>;
export const contextCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function isContextCompaction(entry: Row): boolean {
  return entry.type === 'compacted' || entry.type === 'context_compacted'
    || entry.subtype === 'compact_boundary' || entry.payload?.type === 'context_compacted';
}

export function readCodexContextBudget(event: Row): Row | null {
  if (isContextCompaction(event)) return { used: null };
  const info = event.info ?? event.payload?.info ?? event.usage?.info;
  const last = info?.last_token_usage ?? event.usage?.last_token_usage;
  const billing = info?.total_token_usage ?? event.usage?.total_token_usage ?? event.usage;
  if (!last && !billing) return null;
  const input = contextCount(last?.input_tokens);
  const output = contextCount(last?.output_tokens);
  // Codex input already includes cached input; output already includes reasoning.
  const used = contextCount(last?.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  return {
    used,
    total: contextCount(info?.model_context_window ?? event.usage?.model_context_window),
    inputTokens: contextCount(billing?.input_tokens) ?? 0,
    outputTokens: contextCount(billing?.output_tokens) ?? 0,
  };
}

export function readClaudeContextBudget(event: Row): Row | null {
  if (event.parent_tool_use_id || event.parentToolUseId || event.isSidechain) return null;
  if (isContextCompaction(event)) return { used: null };
  if (event.type !== 'assistant' || event.message?.model === '<synthetic>') return null;
  const usage = event.message?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const direct = contextCount(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = contextCount(usage.output_tokens ?? usage.outputTokens);
  const cacheReadTokens = contextCount(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cacheReadTokens) ?? 0;
  const cacheCreationTokens = contextCount(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? usage.cacheCreationTokens) ?? 0;
  const inputTokens = (direct ?? 0) + cacheReadTokens + cacheCreationTokens;
  return {
    used: direct !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    model: typeof event.message.model === 'string' ? event.message.model : null,
    inputTokens, outputTokens: outputTokens ?? 0, cacheReadTokens, cacheCreationTokens,
    cacheTokens: cacheReadTokens + cacheCreationTokens,
  };
}

/** Adapt native Codex rollout rows to the panel's existing message contract. */
export type TranscriptEntry = {
  type?: string; uuid?: string; timestamp?: string; isMeta?: boolean; isSidechain?: boolean;
  message?: { role?: string; content?: unknown };
  source?: 'codex-event' | 'codex-response';
  payload?: {
    type?: string; role?: string; id?: string; kind?: string; message?: string;
    name?: string; call_id?: string; arguments?: string; input?: string;
    content?: Array<{ type?: string; text?: string }>;
    internal_chat_message_metadata_passthrough?: { content_item_kinds?: string[] };
  };
};

export function normalizeCodexEntry(entry: TranscriptEntry, line: number): TranscriptEntry | null {
  if (entry.type !== 'event_msg' && entry.type !== 'response_item') return entry;
  const p = entry.payload;
  if (!p) return null;
  const base = { uuid: p.id || p.call_id || `codex-${line}`, timestamp: entry.timestamp };
  if (entry.type === 'event_msg') {
    if (p.type !== 'agent_message' && p.type !== 'user_message') return null;
    if (p.type === 'user_message' && p.kind && p.kind !== 'plain') return null;
    return { ...base, source: 'codex-event', type: p.type === 'user_message' ? 'user' : 'assistant',
      message: { content: p.type === 'user_message' ? String(p.message || '') : [{ type: 'text', text: String(p.message || '') }] } };
  }
  if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
    const kinds = p.internal_chat_message_metadata_passthrough?.content_item_kinds;
    // User role alone also includes AGENTS.md, environment and plugin instructions.
    if (p.role === 'user' && !kinds?.some((kind) => kind === 'user.text' || kind === 'user.image')) return null;
    const text = (p.content || []).filter((part, i) => (
      ['input_text', 'output_text', 'text'].includes(part.type || '')
      && (p.role !== 'user' || kinds?.[i] === 'user.text')
    )).map((part) => part.text || '').filter((text) => !/^<\/?image(?:\s|>)/.test(text)).join('\n');
    return { ...base, source: 'codex-response', type: p.role,
      message: { content: p.role === 'user' ? text : [{ type: 'text', text }] } };
  }
  if (p.type !== 'function_call' && p.type !== 'custom_tool_call') return null;
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(p.arguments || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch { /* Incomplete arguments are not user-visible data. */ }
  let name = (p.name || 'unknown').split('.').at(-1)!;
  if (name === 'exec_command' || name === 'shell_command' || name === 'shell') {
    name = 'Bash'; args = { command: args.cmd || args.command || '', description: args.description };
  } else if (name === 'apply_patch') {
    name = 'Edit'; args = { file_path: /\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(p.input || String(args.patch || ''))?.[1] || 'файл' };
  } else if (name === 'request_user_input') {
    name = 'AskUserQuestion';
  } else if (name === 'spawn_agent') {
    name = 'Agent'; args = { description: args.description || args.task_name || '' };
  }
  return { ...base, type: 'assistant', source: 'codex-response',
    message: { content: [{ type: 'tool_use', name, input: args }] } };
}

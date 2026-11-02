import { detectSecrets } from '../../../shared/secret-detect.js';

/** Explicit assistant suggestions only; no heuristic or model-generated extraction. */
export function extractImprovementIdeas(text: string): string[] {
  if (detectSecrets(text).length) return [];
  const clean = text.replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, '');
  const marker = /(?:^|\n)[ \t]*(?:#{1,6}\s*)?(?:💡\s*)?\*{0,2}Что можно улучшить дальше\s*\*{0,2}:\*{0,2}\s*/g;
  const found: string[] = [];
  for (const match of clean.matchAll(marker)) {
    const rest = clean.slice(match.index! + match[0].length);
    const body = rest.split(/\n\s*(?:🕐|⏰|💡|#{1,6}\s|<oai-mem-citation>|Что можно улучшить дальше)/, 1)[0].trim();
    if (body && body.length <= 4000 && !body.includes('<!-- neo3-ideas:')) found.push(body);
  }
  return [...new Set(found)];
}

/** Bounded per-run block collector, independent of transport frame IDs. */
export function createIdeaCollector() {
  const blocks = new Map<string, string>();
  let pending: { text: string; ended: boolean; overflow: boolean } | null = null;
  let sequence = 0;
  const put = (id: string, text: string) => {
    // A replacement without an idea must also remove its previous candidate.
    blocks.delete(id);
    if (text.length > 64_000 || extractImprovementIdeas(text).length === 0) return;
    blocks.set(id, text);
    if (blocks.size > 128) blocks.delete(blocks.keys().next().value!);
  };
  const finish = () => {
    if (pending && !pending.overflow) put(`delta-${sequence++}`, pending.text);
    pending = null;
  };
  return {
    event(event: { kind: string; id?: string; role?: string; content?: unknown }) {
      if (event.kind === 'stream_delta' && event.role !== 'user' && typeof event.content === 'string') {
        if (pending?.ended) finish();
        pending ??= { text: '', ended: false, overflow: false };
        if (!pending.overflow) {
          if (pending.text.length + event.content.length > 64_000) {
            pending.text = '';
            pending.overflow = true;
          } else pending.text += event.content;
        }
      } else if (event.kind === 'stream_end') {
        // Keep it replaceable: providers may send a full snapshot after stream_end.
        if (pending) pending.ended = true;
      } else if (event.kind === 'text' && event.role !== 'user' && typeof event.content === 'string') {
        pending = null;
        put(event.id || `text-${sequence++}`, event.content);
      } else if (event.kind === 'complete') {
        finish();
      }
      // Tools, usage and background updates are not assistant-block boundaries.
    },
    texts() { return [...blocks.values()]; },
  };
}

import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';

/**
 * Grok subagents (helpers) as the chat's crabs.
 *
 * Built from Grok 1.0.52's own docs and tool definitions, before a live sample
 * existed (no Grok session had spawned a helper yet):
 * - `spawn_subagent {prompt, description, background=true, …}` starts one.
 *   Background: the result returns a `subagent_id` (UUIDv7) at once; blocking
 *   (`background:false`): the result is the helper's final message.
 * - The return of a background helper reaches the model later — inside a
 *   tool result, or as a synthetic user turn — as
 *   `Subagent '<description>' (<id>) completed successfully. N tool calls, M turns.`
 *   (`was cancelled`, `hit max-turns limit (…)` for the other endings).
 * - Live `streaming-messages-json` lines of a helper carry
 *   `parent_tool_use_id`; whether it holds the spawn call id or the
 *   subagent id is unknown, so both are resolved to the spawn call.
 *
 * Background shell commands and monitors share `get_command_or_subagent_output`
 * and their own completion turns; they never become crabs because only ids
 * returned by `spawn_subagent` are matched.
 */

export const GROK_SUBAGENT_TOOL = 'spawn_subagent';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export type GrokSubagentReturn = {
  subagentId: string;
  status: 'completed' | 'failed' | 'cancelled';
  toolUses?: number;
  durationMs?: number;
};

function readNumber(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** «in 12s», «in 3m 4s», «in 1h 2m», «in 12.5s» → ms. */
function readDurationMs(text: string): number | undefined {
  const match = /\bin ((?:\d+(?:\.\d+)?\s*[hms]\s*)+)/i.exec(text);
  if (!match) return undefined;
  let total = 0;
  for (const part of match[1].matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)) {
    const value = Number(part[1]);
    const unit = part[2].toLowerCase();
    total += value * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000);
  }
  return total > 0 ? Math.round(total) : undefined;
}

function statusFrom(text: string): GrokSubagentReturn['status'] | null {
  if (/completed successfully|\bcompleted\b|\bfinished\b|\bsucceeded\b/i.test(text)) return 'completed';
  if (/was cancelled|\bcancell?ed\b|\bkilled\b/i.test(text)) return 'cancelled';
  if (/max-turns|\bfailed\b|\berror(?:ed)?\b/i.test(text)) return 'failed';
  return null;
}

/**
 * Returns of the given helpers mentioned in a text. Only ids already known
 * from a `spawn_subagent` result count; a text about a helper that is still
 * running (no ending word next to its id) is not a return.
 */
export function parseGrokSubagentReturns(text: string, knownIds: Iterable<string>): GrokSubagentReturn[] {
  if (!text) return [];
  const returns: GrokSubagentReturn[] = [];
  for (const id of knownIds) {
    const at = text.indexOf(id);
    if (at < 0) continue;
    // The sentence about this id: from the start of its line up to the next
    // helper id or a blank line, so a batch of returns stays per helper.
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const rest = text.slice(at + id.length);
    UUID.lastIndex = 0;
    const nextId = UUID.exec(rest);
    const blank = rest.search(/\n\s*\n/);
    const ends = [nextId ? nextId.index : -1, blank].filter((value) => value >= 0);
    const end = at + id.length + (ends.length > 0 ? Math.min(...ends) : Math.min(rest.length, 400));
    const segment = text.slice(lineStart, end);
    if (/\b(?:is )?(?:still )?running\b|\bstarted\b/i.test(segment) && !/completed|cancel|max-turns|failed/i.test(segment)) {
      continue;
    }
    const status = statusFrom(segment);
    if (!status) continue;
    returns.push({
      subagentId: id,
      status,
      toolUses: readNumber(segment, /(\d+)\s+tool calls?/i),
      durationMs: readDurationMs(segment),
    });
  }
  return returns;
}

/** First helper id in a `spawn_subagent` result. */
export function readGrokSubagentId(text: string): string | null {
  const keyed = /subagent[_ ]?id["'\s:=]+([0-9a-f-]{36})/i.exec(text);
  if (keyed) return keyed[1].toLowerCase();
  UUID.lastIndex = 0;
  const any = UUID.exec(text);
  return any ? any[0].toLowerCase() : null;
}

function readBackground(input: unknown): boolean {
  let value: unknown = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return true;
    }
  }
  return !(value && typeof value === 'object' && (value as Record<string, unknown>).background === false);
}

/**
 * Per-session bookkeeping: which spawn call each helper id belongs to, so a
 * return or a child event can name the crab it closes or feeds.
 */
export class GrokSubagentTracker {
  private readonly backgroundByCall = new Map<string, boolean>();
  private readonly callBySubagent = new Map<string, string>();
  private readonly returned = new Set<string>();

  noteToolUse(toolId: string, toolName: string, input: unknown): void {
    if (toolName === GROK_SUBAGENT_TOOL) {
      this.backgroundByCall.set(toolId, readBackground(input));
    }
  }

  /**
   * A tool result: maps a spawn result to its helper id, and turns any
   * mention of a known helper's ending into a return row. A background spawn
   * that came back without an id never started — it ends at once as failed.
   */
  noteToolResult(
    toolId: string,
    text: string,
    isError: boolean,
    sessionId: string | null,
    provider: LLMProvider,
  ): NormalizedMessage[] {
    const rows: NormalizedMessage[] = [];
    const background = this.backgroundByCall.get(toolId);
    if (background !== undefined) {
      const subagentId = readGrokSubagentId(text);
      if (subagentId) {
        this.callBySubagent.set(subagentId, toolId);
        if (!background) {
          this.returned.add(subagentId);
        }
      } else if (background && isError) {
        rows.push(this.returnRow(toolId, { status: 'failed' }, sessionId, provider));
      }
      return rows;
    }
    return this.noteText(text, sessionId, provider);
  }

  /** Any other text the model was fed (synthetic turns, notifications). */
  noteText(text: string, sessionId: string | null, provider: LLMProvider): NormalizedMessage[] {
    const pending = [...this.callBySubagent.keys()].filter((id) => !this.returned.has(id));
    if (pending.length === 0) return [];
    return parseGrokSubagentReturns(text.toLowerCase(), pending).map((found) => {
      this.returned.add(found.subagentId);
      return this.returnRow(this.callBySubagent.get(found.subagentId) as string, found, sessionId, provider);
    });
  }

  /** The spawn call a helper's own event belongs to (`parent_tool_use_id`). */
  resolveParent(parentToolUseId: string): string {
    if (this.backgroundByCall.has(parentToolUseId)) return parentToolUseId;
    return this.callBySubagent.get(parentToolUseId.toLowerCase()) ?? parentToolUseId;
  }

  private returnRow(
    toolId: string,
    found: Pick<GrokSubagentReturn, 'status' | 'toolUses' | 'durationMs'>,
    sessionId: string | null,
    provider: LLMProvider,
  ): NormalizedMessage {
    const usage = Object.fromEntries(
      Object.entries({ toolUses: found.toolUses, durationMs: found.durationMs })
        .filter(([, value]) => value !== undefined),
    );
    return createNormalizedMessage({
      id: `${toolId}_subagent_return`,
      sessionId,
      provider,
      kind: 'task_notification',
      toolId,
      status: found.status,
      summary: '',
      usage: Object.keys(usage).length > 0 ? usage : undefined,
    });
  }
}

/**
 * The Neo3 session marker (spec decision 11).
 *
 * Every CLI process Neo3 spawns for a chat — and every Claude hook Neo3
 * emulates for Grok — runs with `NEO3_SESSION=1`. User-level hooks in
 * `~/.claude/settings.json` read it to step aside inside Neo3 while staying
 * active in a plain terminal:
 *   - the obsidian-memory Stop hook (Neo3 proposes vault notes itself, see
 *     server/modules/memory-suggestions);
 *   - the CLI secret guard (Neo3's composer has its own guard).
 */
export const NEO3_SESSION_ENV = 'NEO3_SESSION';
export const NEO3_SESSION_VALUE = '1';
/** A copy of `env` with the Neo3 marker set. */
export function withNeo3SessionMarker(env) {
    return { ...env, [NEO3_SESSION_ENV]: NEO3_SESSION_VALUE };
}
//# sourceMappingURL=neo3-session.js.map
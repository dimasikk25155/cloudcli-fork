/**
 * The composer options of the last run a person started in each chat
 * (model, effort, permission mode, tool settings). The auto-relay sends its
 * handoff request and starts the continuation with the same ones, so an
 * automatic turn behaves like a typed one. In memory only: after a restart
 * the chat's stored model/effort are used instead.
 */

const KEPT_KEYS = ['model', 'effort', 'permissionMode', 'workMode', 'toolsSettings', 'skipPermissions'] as const;
const MAX_SESSIONS = 500;

const lastOptions = new Map<string, Record<string, unknown>>();

export function rememberRunOptions(sessionId: string, options: unknown): void {
  if (!sessionId || !options || typeof options !== 'object' || Array.isArray(options)) {
    return;
  }
  const source = options as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of KEPT_KEYS) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      kept[key] = source[key];
    }
  }
  lastOptions.delete(sessionId);
  lastOptions.set(sessionId, kept);
  if (lastOptions.size > MAX_SESSIONS) {
    const oldest = lastOptions.keys().next().value;
    if (oldest !== undefined) lastOptions.delete(oldest);
  }
}

export function lastRunOptions(sessionId: string): Record<string, unknown> | null {
  const options = lastOptions.get(sessionId);
  return options ? { ...options } : null;
}

/** Tests only. */
export function clearRunOptions(): void {
  lastOptions.clear();
}

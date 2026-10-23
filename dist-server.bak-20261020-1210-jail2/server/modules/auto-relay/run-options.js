/**
 * The composer options of the last run a person started in each chat
 * (model, effort, permission mode, tool settings). The auto-relay sends its
 * handoff request and starts the continuation with the same ones, so an
 * automatic turn behaves like a typed one. In memory only: after a restart
 * the chat's stored model/effort are used instead.
 */
const KEPT_KEYS = ['model', 'effort', 'permissionMode', 'workMode', 'toolsSettings', 'skipPermissions'];
const MAX_SESSIONS = 500;
const lastOptions = new Map();
export function rememberRunOptions(sessionId, options) {
    if (!sessionId || !options || typeof options !== 'object' || Array.isArray(options)) {
        return;
    }
    const source = options;
    const kept = {};
    for (const key of KEPT_KEYS) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
            kept[key] = source[key];
        }
    }
    lastOptions.delete(sessionId);
    lastOptions.set(sessionId, kept);
    if (lastOptions.size > MAX_SESSIONS) {
        const oldest = lastOptions.keys().next().value;
        if (oldest !== undefined)
            lastOptions.delete(oldest);
    }
}
export function lastRunOptions(sessionId) {
    const options = lastOptions.get(sessionId);
    return options ? { ...options } : null;
}
/** Tests only. */
export function clearRunOptions() {
    lastOptions.clear();
}
//# sourceMappingURL=run-options.js.map
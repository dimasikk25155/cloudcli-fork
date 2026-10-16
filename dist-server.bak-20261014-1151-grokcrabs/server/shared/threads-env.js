/**
 * Thread identity in the engine process environment.
 *
 * Neo3 issues a thread token per run (server/modules/threads) and hands it to
 * the engine — Claude (`sdkOptions.env`), Grok (spawn env), Codex (SDK env) —
 * as `NEO3_THREADS_TOKEN`, with the address of the Neo3 instance that issued
 * it as `NEO3_THREADS_API_URL`. The engine passes both to its stdio MCP
 * servers; the `neo3-threads` server reads them (server/threads-mcp.ts).
 * Codex passes only whitelisted variables to MCP servers — its registration
 * lists these two names in `env_vars`.
 */
export const NEO3_THREADS_TOKEN_ENV = 'NEO3_THREADS_TOKEN';
export const NEO3_THREADS_API_URL_ENV = 'NEO3_THREADS_API_URL';
export const NEO3_THREADS_ENV_NAMES = [NEO3_THREADS_TOKEN_ENV, NEO3_THREADS_API_URL_ENV];
/**
 * `/api/threads` of this server as engines on this machine reach it — the same
 * port and host rule as server/index.js (`SERVER_PORT`, `HOST`). A server bound
 * to one address (prod: the Tailscale IP) is not reachable on 127.0.0.1, so a
 * concrete HOST is used as is; wildcard or loopback → 127.0.0.1.
 */
export function threadsApiUrl(settings = { host: process.env.HOST, port: process.env.SERVER_PORT }) {
    const rawHost = (settings.host ?? '').trim();
    const wildcardOrLoopback = !rawHost || ['0.0.0.0', '::', 'localhost', '127.0.0.1', '::1', '[::1]'].includes(rawHost);
    const host = wildcardOrLoopback ? '127.0.0.1' : (rawHost.includes(':') && !rawHost.startsWith('[') ? `[${rawHost}]` : rawHost);
    return `http://${host}:${settings.port || '3001'}/api/threads`;
}
/** The run's thread variables from runtime options, or null when the run has none. */
export function threadsEnvOf(options) {
    const env = (options && typeof options === 'object' ? options.threadsEnv : null);
    const token = typeof env?.NEO3_THREADS_TOKEN === 'string' ? env.NEO3_THREADS_TOKEN : '';
    const url = typeof env?.NEO3_THREADS_API_URL === 'string' ? env.NEO3_THREADS_API_URL : '';
    return token && url ? { NEO3_THREADS_TOKEN: token, NEO3_THREADS_API_URL: url } : null;
}
/**
 * A copy of `env` carrying exactly this run's thread variables. Inherited ones
 * are always dropped first: a Neo3 started from inside an agent run must not
 * hand that outer run's identity to its own engines.
 */
export function withThreadsEnv(env, options) {
    const next = { ...env };
    for (const name of NEO3_THREADS_ENV_NAMES) {
        delete next[name];
    }
    const runEnv = threadsEnvOf(options);
    if (runEnv) {
        Object.assign(next, runEnv);
    }
    return next;
}
//# sourceMappingURL=threads-env.js.map
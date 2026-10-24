import { randomUUID } from 'node:crypto';
/**
 * Holds clone requests between the POST that submits them and the EventSource
 * GET that runs them. The browser's EventSource can only issue a bare GET, so
 * whatever it needs has to travel in the URL — and a URL is written to access
 * logs, proxy logs and browser history. The token therefore arrives in a POST
 * body and waits here, and the GET carries nothing but the opaque id.
 *
 * Every entry is bound to the user who posted it, is handed out once, and is
 * dropped after `ttlMs` whether or not it was claimed.
 */
export function createPendingCloneRequests(ttlMs) {
    const pending = new Map();
    return {
        add(userId, request) {
            const cloneId = randomUUID();
            const expiry = setTimeout(() => {
                pending.delete(cloneId);
            }, ttlMs);
            // An abandoned request must not keep the process alive on shutdown.
            expiry.unref();
            pending.set(cloneId, { userId, request, expiry });
            return cloneId;
        },
        claim(cloneId, userId) {
            const entry = pending.get(cloneId);
            if (!entry || entry.userId !== userId) {
                return null;
            }
            clearTimeout(entry.expiry);
            pending.delete(cloneId);
            return entry.request;
        },
    };
}
//# sourceMappingURL=project-clone-request.service.js.map
/**
 * Live subscription usage for the Kimi Code subscription (separate from the
 * Claude account). Reads KIMI_CODE_KEY from the environment (cloudcli-launch.sh
 * loads it from ~/Antigravity Project/.secrets.env) and asks Kimi's managed
 * platform endpoint GET https://api.kimi.com/coding/v1/usages — the same
 * endpoint the official Kimi Code CLI uses for its quota panel.
 *
 * The payload mirrors Claude's shape: a weekly window plus a short rolling
 * window (300 minutes ≈ 5 hours), both as used/limit counters with a reset
 * timestamp. Responses are cached for a minute so the polling badge and any
 * pre-send checks stay cheap.
 */
const USAGE_ENDPOINT = 'https://api.kimi.com/coding/v1/usages';
const CACHE_TTL_MS = 60_000;
const SHORT_WINDOW_MINUTES = 300;
let cached = null;
function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}
function toWindow(detail) {
    if (!detail || typeof detail !== 'object') {
        return null;
    }
    const record = detail;
    const limit = toNumber(record.limit);
    const used = toNumber(record.used);
    if (limit === null || limit <= 0 || used === null) {
        return null;
    }
    return {
        utilization: Math.min(100, (used / limit) * 100),
        resetsAt: typeof record.resetTime === 'string' ? record.resetTime : null,
    };
}
/**
 * Fetches (or serves from the 60s cache) the current Kimi subscription usage.
 * Returns null when the key is missing or the endpoint fails — callers treat
 * that as "usage unknown", never as an error.
 */
export async function getKimiUsage() {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.snapshot;
    }
    let snapshot = null;
    const key = (process.env.KIMI_CODE_KEY || '').trim();
    if (key) {
        try {
            const response = await fetch(USAGE_ENDPOINT, {
                headers: { Authorization: `Bearer ${key}` },
                signal: AbortSignal.timeout(15_000),
            });
            if (response.ok) {
                const payload = await response.json();
                const limits = Array.isArray(payload.limits) ? payload.limits : [];
                const shortWindow = limits.find((entry) => {
                    const window = entry?.window;
                    return Number(window?.duration) === SHORT_WINDOW_MINUTES;
                });
                snapshot = {
                    fiveHour: toWindow(shortWindow?.detail),
                    sevenDay: toWindow(payload.usage),
                    fetchedAt: new Date().toISOString(),
                };
            }
        }
        catch {
            snapshot = null;
        }
    }
    // Failures are cached too, so a missing key can't turn every badge poll
    // into a fresh network round-trip.
    cached = { at: Date.now(), snapshot };
    return snapshot;
}
//# sourceMappingURL=kimi-usage.js.map
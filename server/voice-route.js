// Network route to the speech backend.
//
// Groq refuses Russian addresses with a bare 403 "Forbidden". The agents reach
// it through the AI bridge (HTTP proxy on 127.0.0.1:12809, exit 45.86.61.144),
// but this server runs from a LaunchAgent without proxy variables, so with the
// Mac VPN off every dictation came back as 502. Requests to a public backend
// therefore go direct first and, on that 403 or a network failure, once more
// through the bridge; after a bridge success the bridge is used first for a
// while, so each dictation does not pay for the refused direct attempt.
//
// VOICE_PROXY_URL: unset = the bridge on 127.0.0.1:12809; `off` = never;
// any other value = that proxy URL.

export const DEFAULT_VOICE_PROXY_URL = 'http://127.0.0.1:12809';
export const PROXY_STICKY_MS = 10 * 60 * 1000;

/** @param {string | undefined} raw */
export function resolveVoiceProxyUrl(raw) {
  const value = String(raw ?? '').trim();
  if (/^(off|none|false|0)$/i.test(value)) return '';
  return value || DEFAULT_VOICE_PROXY_URL;
}

/**
 * Local, private and Tailscale backends (LocalAI, Speaches, a Windows box) are
 * reached directly; only public hosts may need the bridge.
 * @param {string} hostname
 */
export function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.ts.net')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

/** A stream body is spent after the first attempt and cannot be replayed. */
function replayable(body) {
  return !(body && typeof body === 'object' && typeof body.getReader === 'function');
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   proxyUrl: string,
 *   getDispatcher: (proxyUrl: string) => Promise<unknown | null>,
 *   now?: () => number,
 *   log?: (message: string) => void,
 * }} deps
 * @returns {(url: URL, options: RequestInit) => Promise<Response>}
 */
export function createVoiceBackendFetch({ fetchImpl = (url, options) => globalThis.fetch(url, options), proxyUrl, getDispatcher, now = Date.now, log = () => {} }) {
  let bridgeFirstUntil = 0;

  return async function voiceBackendFetch(url, options) {
    if (!proxyUrl || isPrivateHost(url.hostname)) return fetchImpl(url, options);

    const viaBridge = async () => {
      const dispatcher = await getDispatcher(proxyUrl);
      if (!dispatcher) return null;
      return fetchImpl(url, { ...options, dispatcher });
    };
    const aborted = (error) => error?.name === 'AbortError' || options.signal?.aborted;

    if (now() < bridgeFirstUntil) {
      try {
        const response = await viaBridge();
        if (response && response.status !== 403) return response;
      } catch (error) {
        if (aborted(error)) throw error;
      }
      bridgeFirstUntil = 0;
      log('[voice] bridge route failed, trying direct');
    }

    let direct;
    try {
      direct = await fetchImpl(url, options);
    } catch (error) {
      if (aborted(error) || !replayable(options.body)) throw error;
      const response = await viaBridge().catch((bridgeError) => {
        if (aborted(bridgeError)) throw bridgeError;
        return null;
      });
      if (!response) throw error;
      if (response.status !== 403) bridgeFirstUntil = now() + PROXY_STICKY_MS;
      log(`[voice] direct route failed (${error.message}); bridge answered ${response.status}`);
      return response;
    }

    if (direct.status !== 403 || !replayable(options.body)) return direct;
    const response = await viaBridge().catch((bridgeError) => {
      if (aborted(bridgeError)) throw bridgeError;
      return null;
    });
    if (!response) return direct;
    if (response.status !== 403) {
      bridgeFirstUntil = now() + PROXY_STICKY_MS;
      log(`[voice] backend refused the direct route (403); bridge answered ${response.status}`);
    }
    return response;
  };
}

let dispatcherPromise = null;

/**
 * undici's ProxyAgent, loaded lazily. undici is not a declared dependency of
 * this package, so its absence just disables the bridge route.
 * @param {string} proxyUrl
 */
export function loadProxyDispatcher(proxyUrl) {
  if (!dispatcherPromise) {
    dispatcherPromise = import('undici')
      .then(({ ProxyAgent }) => new ProxyAgent(proxyUrl))
      .catch((error) => {
        console.warn(`[voice] bridge route unavailable: ${error.message}`);
        return null;
      });
  }
  return dispatcherPromise;
}

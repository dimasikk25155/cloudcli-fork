// Only accept a refreshed token that has this app's issued JWT shape
// (three base64url segments). An attacker-injected/malformed header value
// must never overwrite the stored auth token.
/**
 * @param {unknown} token
 * @returns {token is string}
 */
export const isValidRefreshedToken = (token) =>
  typeof token === 'string' &&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

/**
 * @param {string | null} token
 * @returns {{ iat?: number, exp?: number } | null}
 */
const readJwtClaims = (token) => {
  try {
    const segment = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, '=')));
  } catch {
    return null;
  }
};

/**
 * A browser cache can replay an old response together with its old
 * X-Refreshed-Token header. Saving that expired token logs the user out right
 * after a successful login, so only a live token at least as fresh as the
 * current one may replace it.
 * @param {unknown} refreshedToken
 * @param {string | null} currentToken
 * @param {number} [nowSeconds]
 * @returns {refreshedToken is string}
 */
export const shouldStoreRefreshedToken = (
  refreshedToken,
  currentToken,
  nowSeconds = Math.floor(Date.now() / 1000),
) => {
  if (!isValidRefreshedToken(refreshedToken) || refreshedToken === currentToken) {
    return false;
  }
  const next = readJwtClaims(refreshedToken);
  if (!next || typeof next.exp !== 'number' || next.exp <= nowSeconds) {
    return false;
  }
  const current = currentToken ? readJwtClaims(currentToken) : null;
  if (current && typeof current.iat === 'number' && typeof next.iat === 'number') {
    return next.iat >= current.iat;
  }
  return true;
};

/** @param {unknown} refreshedToken */
export const storeRefreshedToken = (refreshedToken) => {
  try {
    if (shouldStoreRefreshedToken(refreshedToken, localStorage.getItem('auth-token'))) {
      localStorage.setItem('auth-token', refreshedToken);
    }
  } catch (error) {
    console.warn('Could not save refreshed auth token:', error);
  }
};

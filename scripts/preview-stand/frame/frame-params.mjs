// Parameters of the phone-frame link. No DOM and no Node APIs: the same file is
// imported by the frame page in the browser and by the stand script in Node.

export const FRAME_PATH = '/stand/frame.html';
export const DEFAULT_WIDTH = 390;
export const MIN_WIDTH = 320;
export const MAX_WIDTH = 1280;
export const MIN_HEIGHT = 480;
export const MAX_HEIGHT = 2000;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
/** Phones side by side in one frame page: three fit a 1280 px window at 390. */
export const MAX_PHONES = 4;

/** Screen heights of the two iPhone sizes the build is checked on. */
const HEIGHT_BY_WIDTH = { 390: 844, 430: 932 };
const FALLBACK_HEIGHT = 844;

/** Theme and variant ids are plain identifiers (`ember`, `neonCity`, `city`). */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export const defaultHeightFor = (width) => HEIGHT_BY_WIDTH[width] ?? FALLBACK_HEIGHT;

const isWholeNumberIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export const isFrameWidth = (value) => isWholeNumberIn(value, MIN_WIDTH, MAX_WIDTH);
export const isFrameHeight = (value) => isWholeNumberIn(value, MIN_HEIGHT, MAX_HEIGHT);
/** `fit` shrinks the phone to the window height; a number is a fixed factor. */
export const isFrameZoom = (value) =>
  value === 'fit' || (typeof value === 'number' && Number.isFinite(value) && value >= MIN_ZOOM && value <= MAX_ZOOM);
export const isFrameId = (value) => typeof value === 'string' && ID_PATTERN.test(value);

/**
 * The app route shown inside the frame. Only a path on the stand's own origin:
 * `//host` and `/\host` are how a browser is talked into leaving it.
 */
export const isFramePath = (value) =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\');

/**
 * One entry of `themes`: `ember` or `neon:city` (theme and its variant).
 * Returns `{ theme, variant }` or null when the entry is not usable.
 */
export function parsePhoneToken(token) {
  if (typeof token !== 'string') {
    return null;
  }
  const [theme, variant, ...extra] = token.split(':');
  if (extra.length > 0 || !isFrameId(theme) || (variant !== undefined && !isFrameId(variant))) {
    return null;
  }
  return { theme, variant: variant ?? null };
}

const readWholeNumber = (raw) => (/^\d{1,5}$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN);

/**
 * Reads the query string of the frame link. A value the frame cannot use falls
 * back to the default and is listed in `problems` (`name=raw value`) so the
 * page can say so instead of silently showing something else.
 */
export function normalizeFrameParams(search) {
  const query = new URLSearchParams(search);
  const problems = [];
  const reject = (name) => {
    problems.push(`${name}=${query.get(name)}`);
  };

  let width = DEFAULT_WIDTH;
  if (query.has('w')) {
    const asked = readWholeNumber(query.get('w'));
    if (isFrameWidth(asked)) {
      width = asked;
    } else {
      reject('w');
    }
  }

  let height = defaultHeightFor(width);
  if (query.has('h')) {
    const asked = readWholeNumber(query.get('h'));
    if (isFrameHeight(asked)) {
      height = asked;
    } else {
      reject('h');
    }
  }

  const readId = (name) => {
    if (!query.has(name)) {
      return null;
    }
    const asked = query.get(name);
    if (isFrameId(asked)) {
      return asked;
    }
    reject(name);
    return null;
  };

  // `themes=ember,glass,neon:city` — several phones; otherwise one from `theme` and `variant`.
  let phones = [];
  if (query.has('themes')) {
    for (const token of query.get('themes').split(',').filter((entry) => entry !== '')) {
      const phone = phones.length < MAX_PHONES ? parsePhoneToken(token) : null;
      if (phone) {
        phones.push(phone);
      } else {
        problems.push(`themes=${token}`);
      }
    }
  }
  if (phones.length === 0) {
    phones = [{ theme: readId('theme'), variant: readId('variant') }];
  }

  let path = '/';
  if (query.has('path')) {
    const asked = query.get('path');
    if (isFramePath(asked)) {
      path = asked;
    } else {
      reject('path');
    }
  }

  let zoom = 'fit';
  if (query.has('zoom') && query.get('zoom') !== 'fit') {
    const raw = query.get('zoom');
    const asked = /^\d(\.\d{1,2})?$/.test(raw) ? Number.parseFloat(raw) : Number.NaN;
    if (isFrameZoom(asked)) {
      zoom = asked;
    } else {
      reject('zoom');
    }
  }

  return {
    width,
    height,
    phones,
    path,
    zoom,
    login: query.get('login') !== '0',
    sync: query.get('sync') !== '0',
    fresh: query.get('fresh') === '1',
    problems,
  };
}

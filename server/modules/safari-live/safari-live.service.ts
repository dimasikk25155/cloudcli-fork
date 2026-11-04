/**
 * «Safari вживую»: the one owner of the capture helper processes.
 *
 * - `list` is cached for `listCacheMs` (the tab and the agent may ask often).
 * - One `stream` process per Safari window, shared by every viewer; a new
 *   viewer gets the last frame at once; the last viewer leaving stops the
 *   process after `idleMs`.
 * - One `display` process (the invisible «Neo3 Safari» monitor) per server
 *   life: creating it shakes the monitor layout for a few seconds, so it is
 *   created on first need and kept; a dead one is recreated on the next call.
 * - Any helper failure is returned as a state with a message, never thrown.
 */

import type {
  DisplayProcess,
  EnsureDisplayResult,
  HelperResult,
  OpenWindowResult,
  PlaceResult,
  SafariLiveDeps,
  SafariLiveService,
  SafariLiveState,
  SafariRect,
  SafariViewer,
  SafariWindow,
  SafariWindowList,
  StreamEnd,
  StreamProcess,
} from './safari-live.types.js';

/** Exit code the default helper runners use when the binary is not there. */
export const HELPER_MISSING_CODE = 127;

export const SAFARI_TEXT = {
  unsupported: 'Safari вживую работает только на Mac',
  helperMissing: 'Safari вживую: помощник не установлен (scripts/safari-capture/build.sh)',
  noPermission: 'Нет разрешения «Запись экрана»',
  failed: 'Помощник Safari не ответил',
  displayFailed: 'Невидимый экран для Safari не создан',
  badUrl: 'Нужен адрес страницы http(s)',
} as const;

/** Untitled windows (the 500×500 service window of Safari) are not pages: never picked, never listed in the tab. */
export function isTitledWindow(window: Pick<SafariWindow, 'title'>): boolean {
  return window.title.trim() !== '';
}

/** Normalised http(s) address (quotes and spaces percent-encoded), or null. */
export function normalizePageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function readWindowId(stdout: string): number | null {
  try {
    const parsed = JSON.parse(String(stdout || '').trim()) as { windowId?: unknown };
    const windowId = Number(parsed?.windowId);
    return Number.isSafeInteger(windowId) && windowId > 0 ? windowId : null;
  } catch {
    return null;
  }
}

const STREAM_OPTIONS = { fps: 3, maxWidth: 1280, quality: 0.6 };

type HelperError = { error?: string; message?: string };

/** Last JSON line of the helper's stderr (`{"error":…, "message":…}`), if any. */
export function readHelperError(stderr: string): HelperError {
  const lines = String(stderr || '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as HelperError;
    } catch {
      // not a JSON line — keep looking
    }
  }
  return {};
}

function failureText(result: HelperResult): string {
  if (result.code === HELPER_MISSING_CODE) return SAFARI_TEXT.helperMissing;
  const parsed = readHelperError(result.stderr);
  return parsed.message || parsed.error || SAFARI_TEXT.failed;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? `${SAFARI_TEXT.failed}: ${error.message}` : SAFARI_TEXT.failed;
}

function toWindow(raw: unknown): SafariWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const windowId = Number(value.windowId);
  if (!Number.isSafeInteger(windowId) || windowId <= 0) return null;
  return {
    windowId,
    title: typeof value.title === 'string' ? value.title : '',
    onScreen: value.onScreen === true,
    width: Number(value.width) || 0,
    height: Number(value.height) || 0,
  };
}

/** `neo3-safari-capture list` result → window list state. */
export function parseListResult(result: HelperResult): SafariWindowList {
  if (result.code === 3) return { state: 'no_permission', windows: [], message: SAFARI_TEXT.noPermission };
  if (result.code !== 0) return { state: 'error', windows: [], message: failureText(result) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(result.stdout || '').trim());
  } catch {
    return { state: 'error', windows: [], message: SAFARI_TEXT.failed };
  }
  const value = (parsed && typeof parsed === 'object' ? parsed : {}) as { permission?: unknown; windows?: unknown };
  if (value.permission === false) return { state: 'no_permission', windows: [], message: SAFARI_TEXT.noPermission };
  if (!Array.isArray(value.windows)) return { state: 'error', windows: [], message: SAFARI_TEXT.failed };
  return { state: 'ok', windows: value.windows.map(toWindow).filter((window): window is SafariWindow => window !== null) };
}

type StreamEntry = {
  process: StreamProcess;
  viewers: Set<SafariViewer>;
  lastFrame: Buffer | null;
  idleTimer: NodeJS.Timeout | null;
};

type DisplayEntry = {
  process: DisplayProcess;
  bounds: SafariRect | null;
  pending: Promise<EnsureDisplayResult>;
};

export function createSafariLiveService(deps: SafariLiveDeps = {}): SafariLiveService {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;
  const idleMs = deps.idleMs ?? 20_000;
  const listCacheMs = deps.listCacheMs ?? 2_000;
  const displayReadyMs = deps.displayReadyMs ?? 20_000;
  const supported = platform === 'darwin';

  const streams = new Map<number, StreamEntry>();
  let display: DisplayEntry | null = null;
  let listCache: { at: number; list: SafariWindowList } | null = null;

  async function listWindows(): Promise<SafariWindowList> {
    if (!supported) return { state: 'unsupported', windows: [], message: SAFARI_TEXT.unsupported };
    if (listCache && now() - listCache.at < listCacheMs) return listCache.list;
    let list: SafariWindowList;
    if (!deps.runList) {
      list = { state: 'error', windows: [], message: SAFARI_TEXT.helperMissing };
    } else {
      try {
        list = parseListResult(await deps.runList());
      } catch (error) {
        list = { state: 'error', windows: [], message: errorText(error) };
      }
    }
    listCache = { at: now(), list };
    return list;
  }

  async function pickWindow(titleContains?: string) {
    const list = await listWindows();
    const needle = typeof titleContains === 'string' ? titleContains.trim().toLocaleLowerCase() : '';
    let window: SafariWindow | null = null;
    for (const candidate of list.windows) {
      if (!isTitledWindow(candidate)) continue;
      if (needle && !candidate.title.toLocaleLowerCase().includes(needle)) continue;
      if (!window || candidate.windowId > window.windowId) window = candidate;
    }
    return { window, list };
  }

  function endLater(viewer: SafariViewer, end: StreamEnd, message?: string): void {
    setImmediate(() => {
      try {
        viewer.onEnd(end, message);
      } catch {
        // a broken viewer must not take the server down
      }
    });
  }

  function dropEntry(windowId: number, entry: StreamEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    if (streams.get(windowId) === entry) streams.delete(windowId);
  }

  function startStream(windowId: number): StreamEntry {
    if (!deps.spawnStream) throw new Error(SAFARI_TEXT.helperMissing);
    const process = deps.spawnStream(windowId, { ...STREAM_OPTIONS });
    const entry: StreamEntry = { process, viewers: new Set(), lastFrame: null, idleTimer: null };
    process.onFrame((jpeg) => {
      if (streams.get(windowId) !== entry) return;
      entry.lastFrame = jpeg;
      for (const viewer of [...entry.viewers]) {
        try {
          viewer.onFrame(jpeg);
        } catch {
          // ignore one broken viewer
        }
      }
    });
    process.onExit((end, message) => {
      if (streams.get(windowId) !== entry) return;
      dropEntry(windowId, entry);
      // The tab rereads the view right after: it must see the window gone, not a 2 s old list.
      if (end === 'window_gone') listCache = null;
      const viewers = [...entry.viewers];
      entry.viewers.clear();
      for (const viewer of viewers) {
        try {
          viewer.onEnd(end, message);
        } catch {
          // ignore
        }
      }
    });
    return entry;
  }

  function subscribe(windowId: number, viewer: SafariViewer): () => void {
    if (!supported) {
      endLater(viewer, 'error', SAFARI_TEXT.unsupported);
      return () => {};
    }
    let entry = streams.get(windowId);
    if (!entry) {
      try {
        entry = startStream(windowId);
      } catch (error) {
        endLater(viewer, 'error', errorText(error));
        return () => {};
      }
      streams.set(windowId, entry);
    }
    const current = entry;
    if (current.idleTimer) {
      clearTimeout(current.idleTimer);
      current.idleTimer = null;
    }
    current.viewers.add(viewer);
    if (current.lastFrame) {
      try {
        viewer.onFrame(current.lastFrame);
      } catch {
        // ignore
      }
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      current.viewers.delete(viewer);
      if (current.viewers.size > 0 || streams.get(windowId) !== current || current.idleTimer) return;
      current.idleTimer = setTimeout(() => {
        current.idleTimer = null;
        if (current.viewers.size > 0 || streams.get(windowId) !== current) return;
        dropEntry(windowId, current);
        current.process.stop();
      }, idleMs);
      current.idleTimer.unref?.();
    };
  }

  function ensureDisplay(): Promise<EnsureDisplayResult> {
    if (!supported) return Promise.resolve({ ok: false, state: 'unsupported', message: SAFARI_TEXT.unsupported });
    if (display) return display.pending;
    if (!deps.spawnDisplay) {
      return Promise.resolve({ ok: false, state: 'error', message: SAFARI_TEXT.helperMissing });
    }
    let process: DisplayProcess;
    try {
      process = deps.spawnDisplay();
    } catch (error) {
      return Promise.resolve({ ok: false, state: 'error', message: errorText(error) });
    }
    let settle: (result: EnsureDisplayResult) => void = () => {};
    const pending = new Promise<EnsureDisplayResult>((resolve) => { settle = resolve; });
    const entry: DisplayEntry = { process, bounds: null, pending };
    display = entry;
    let settled = false;
    const finish = (result: EnsureDisplayResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      settle(result);
    };
    const readyTimer = setTimeout(() => {
      if (display === entry) display = null;
      process.stop();
      finish({ ok: false, state: 'error', message: `${SAFARI_TEXT.displayFailed}: нет ответа` });
    }, displayReadyMs);
    readyTimer.unref?.();
    process.onReady((bounds) => {
      entry.bounds = bounds;
      finish({ ok: true, bounds });
    });
    process.onExit((code, message) => {
      if (display === entry) display = null;
      const state: SafariLiveState = code === 3 ? 'no_permission' : 'error';
      const text = code === HELPER_MISSING_CODE
        ? SAFARI_TEXT.helperMissing
        : `${SAFARI_TEXT.displayFailed}${message ? `: ${message}` : ''}`;
      finish({ ok: false, state, message: text });
    });
    return pending;
  }

  async function placeOnDisplay(windowId: number): Promise<PlaceResult> {
    const shown = await ensureDisplay();
    if (!shown.ok) return { ok: false, end: shown.state === 'no_permission' ? 'no_permission' : 'error', message: shown.message };
    if (!deps.runPlace) return { ok: false, end: 'error', message: SAFARI_TEXT.helperMissing };
    try {
      const result = await deps.runPlace(windowId, { ...shown.bounds });
      if (result.code === 0) return { ok: true };
      if (result.code === 4) return { ok: false, end: 'window_gone', message: failureText(result) };
      return { ok: false, end: 'error', message: failureText(result) };
    } catch (error) {
      return { ok: false, end: 'error', message: errorText(error) };
    }
  }

  async function openWindow(url: string, windowId?: number): Promise<OpenWindowResult> {
    if (!supported) return { ok: false, state: 'unsupported', message: SAFARI_TEXT.unsupported };
    const address = normalizePageUrl(url);
    if (!address) return { ok: false, state: 'error', message: SAFARI_TEXT.badUrl };
    if (!deps.runOpen) return { ok: false, state: 'error', message: SAFARI_TEXT.helperMissing };
    try {
      const result = await deps.runOpen(address, windowId);
      listCache = null;
      if (result.code === 0) {
        const opened = readWindowId(result.stdout);
        if (opened) return { ok: true, windowId: opened };
        return { ok: false, state: 'error', message: SAFARI_TEXT.failed };
      }
      if (result.code === 4) return { ok: false, state: 'error', end: 'window_gone', message: failureText(result) };
      return { ok: false, state: 'error', message: failureText(result) };
    } catch (error) {
      return { ok: false, state: 'error', message: errorText(error) };
    }
  }

  function stopAll(): void {
    for (const [windowId, entry] of [...streams]) {
      dropEntry(windowId, entry);
      entry.viewers.clear();
      entry.process.stop();
    }
    if (display) {
      const entry = display;
      display = null;
      entry.process.stop();
    }
    listCache = null;
  }

  return {
    listWindows,
    pickWindow,
    subscribe,
    ensureDisplay,
    placeOnDisplay,
    openWindow,
    activeStreams: () => streams.size,
    stopAll,
  };
}

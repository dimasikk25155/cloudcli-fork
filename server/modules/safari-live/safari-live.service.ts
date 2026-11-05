/**
 * «Браузер вживую»: pages of Neo3's own invisible browser, their live pictures and input.
 *
 * - The helper starts only for real work (open, command, a viewer); listing pages
 *   while it is not running answers «no pages» without starting it.
 * - One driver watch per page, shared by every viewer; a new viewer gets the last
 *   frame at once; the last viewer leaving stops the watch (the driver unloads the
 *   helper after its idle time).
 * - A viewer of a page that is not open with a restore address → the page is opened
 *   there first (helper unloaded, died, or running for other pages), then the viewer is
 *   told it came back (`onRestored`: the tab rereads «Вживую» and the page list). A page
 *   the agent closed never comes back: its binding has no address (kept in the database,
 *   survives restarts) and this process remembers it too.
 * - Closing the last page while nobody watches unloads the helper at once.
 * - Helper failures of commands reach the caller as `BrowserError`; the list is a state.
 */

import { BrowserError } from './safari-live.browser.js';
import type {
  BrowserInput,
  BrowserReply,
  OpenedPage,
  SafariLiveDeps,
  SafariLiveService,
  SafariRestore,
  SafariViewer,
  SafariWindow,
  SafariWindowList,
  StreamEnd,
} from './safari-live.types.js';

export const PAGE_WIDTH = 1280;
export const PAGE_HEIGHT = 800;

export const BROWSER_TEXT = {
  unsupported: 'Браузер вживую работает только на Mac',
  helperMissing: 'Браузер не установлен (scripts/neo3-browser/build.sh)',
  failed: 'Браузер не ответил',
  badUrl: 'Нужен адрес страницы http(s)',
} as const;

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

/** Page id of a chat's own page. */
export function chatPageId(sessionId: string): string {
  return `chat-${sessionId}`;
}

function toWindow(raw: unknown): SafariWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.page !== 'string' || !value.page) return null;
  return {
    pageId: value.page,
    title: typeof value.title === 'string' ? value.title : '',
    url: typeof value.url === 'string' ? value.url : '',
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  };
}

type StreamEntry = {
  viewers: Set<SafariViewer>;
  lastFrame: Buffer | null;
  unwatch: (() => void) | null;
};

function safeEnd(viewer: SafariViewer, end: StreamEnd, message?: string): void {
  try {
    viewer.onEnd(end, message);
  } catch {
    // a broken viewer must not take the server down
  }
}

export function createSafariLiveService(deps: SafariLiveDeps = {}): SafariLiveService {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;
  const listCacheMs = deps.listCacheMs ?? 1_000;
  const helperInstalled = deps.helperInstalled ?? (() => true);
  const supported = platform === 'darwin';
  const driver = deps.driver;

  const streams = new Map<string, StreamEntry>();
  /** Pages the agent closed itself: never restored until opened again. */
  const closedByAgent = new Set<string>();
  let listCache: { at: number; list: SafariWindowList } | null = null;

  function unavailable(): BrowserError | null {
    if (!supported) return new BrowserError('unsupported', BROWSER_TEXT.unsupported);
    if (!driver || !helperInstalled()) return new BrowserError('helper_missing', BROWSER_TEXT.helperMissing);
    return null;
  }

  function endEntry(pageId: string, end: StreamEnd, message?: string): void {
    const entry = streams.get(pageId);
    if (!entry) return;
    streams.delete(pageId);
    entry.unwatch?.();
    entry.unwatch = null;
    const viewers = [...entry.viewers];
    entry.viewers.clear();
    for (const viewer of viewers) safeEnd(viewer, end, message);
  }

  driver?.onEvent((event) => {
    listCache = null;
    if (event.event === 'closed') {
      endEntry(event.page, 'page_gone');
    } else if (event.event === 'exit') {
      // The watches died with the process; the driver dropped them already.
      for (const entry of streams.values()) entry.unwatch = null;
      for (const pageId of [...streams.keys()]) endEntry(pageId, event.reason === 'stopped' ? 'stopped' : 'page_gone');
    } else if (event.event === 'navigated') {
      try {
        deps.onNavigated?.(event.page, event.url, event.title);
      } catch {
        // keeping the last address is best effort
      }
    }
  });

  async function listWindows(): Promise<SafariWindowList> {
    if (!supported) return { state: 'unsupported', windows: [], message: BROWSER_TEXT.unsupported };
    if (!driver || !helperInstalled()) return { state: 'error', windows: [], message: BROWSER_TEXT.helperMissing };
    if (!driver.isRunning()) return { state: 'ok', windows: [] };
    if (listCache && now() - listCache.at < listCacheMs) return listCache.list;
    let list: SafariWindowList;
    try {
      const reply = await driver.request('list', {}, { passive: true });
      const pages = Array.isArray(reply.pages) ? reply.pages : [];
      list = { state: 'ok', windows: pages.map(toWindow).filter((page): page is SafariWindow => page !== null) };
    } catch (error) {
      if (!driver.isRunning()) return { state: 'ok', windows: [] };
      list = { state: 'error', windows: [], message: error instanceof Error && error.message ? `${BROWSER_TEXT.failed}: ${error.message}` : BROWSER_TEXT.failed };
    }
    listCache = { at: now(), list };
    return list;
  }

  async function openPage(pageId: string, url: string): Promise<OpenedPage> {
    const blocked = unavailable();
    if (blocked) throw blocked;
    const address = normalizePageUrl(url);
    if (!address) throw new BrowserError('bad_url', BROWSER_TEXT.badUrl);
    const reply = await driver!.request('open', { page: pageId, url: address });
    closedByAgent.delete(pageId);
    listCache = null;
    return {
      pageId,
      url: typeof reply.url === 'string' && reply.url ? reply.url : address,
      title: typeof reply.title === 'string' ? reply.title : '',
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      loading: reply.loading === true,
    };
  }

  async function closePage(pageId: string): Promise<{ closed: boolean; unloaded: boolean }> {
    closedByAgent.add(pageId);
    if (!driver || !driver.isRunning()) return { closed: false, unloaded: true };
    const reply = await driver.request('close', { page: pageId });
    listCache = null;
    const left = Number(reply.pages);
    // «Открыл, попользовался, закрыл»: nothing left to show → the helper leaves memory now.
    if (left === 0 && streams.size === 0) {
      driver.stop();
      return { closed: true, unloaded: true };
    }
    return { closed: true, unloaded: false };
  }

  async function command(op: string, pageId: string, args: Record<string, unknown> = {}): Promise<BrowserReply> {
    const blocked = unavailable();
    if (blocked) throw blocked;
    return driver!.request(op, { ...args, page: pageId });
  }

  async function input(pageId: string, event: BrowserInput): Promise<void> {
    await command('input', pageId, { ...event });
  }

  function canRestore(pageId: string): boolean {
    return supported && Boolean(driver) && !closedByAgent.has(pageId);
  }

  async function startWatching(pageId: string, entry: StreamEntry, restore?: SafariRestore): Promise<void> {
    let alive = false;
    const restorable = Boolean(restore?.url) && canRestore(pageId);
    if (driver!.isRunning()) {
      try {
        const reply = await driver!.request('list', {}, { passive: true });
        alive = Array.isArray(reply.pages) && reply.pages.some((page) => toWindow(page)?.pageId === pageId);
      } catch {
        alive = false;
      }
    }
    if (streams.get(pageId) !== entry || entry.viewers.size === 0) return;
    let restored = false;
    if (!alive && restorable && restore) {
      try {
        await openPage(pageId, restore.url);
        alive = true;
        restored = true;
      } catch (error) {
        if (streams.get(pageId) === entry) endEntry(pageId, 'error', error instanceof Error ? error.message : undefined);
        return;
      }
    }
    if (streams.get(pageId) !== entry) return;
    if (!alive) {
      endEntry(pageId, 'page_gone');
      return;
    }
    if (entry.viewers.size === 0) return;
    entry.unwatch = driver!.watch(pageId, (jpeg) => {
      if (streams.get(pageId) !== entry) return;
      entry.lastFrame = jpeg;
      for (const viewer of [...entry.viewers]) {
        try {
          viewer.onFrame(jpeg);
        } catch {
          // ignore one broken viewer
        }
      }
    });
    if (restored) {
      try {
        restore?.onRestored?.();
      } catch {
        // the ping is best effort
      }
    }
  }

  function subscribe(pageId: string, viewer: SafariViewer, restore?: SafariRestore): () => void {
    const blocked = unavailable();
    if (blocked) {
      setImmediate(() => safeEnd(viewer, 'error', blocked.message));
      return () => {};
    }
    let entry = streams.get(pageId);
    const fresh = !entry;
    if (!entry) {
      entry = { viewers: new Set(), lastFrame: null, unwatch: null };
      streams.set(pageId, entry);
    }
    const current = entry;
    current.viewers.add(viewer);
    if (current.lastFrame) {
      try {
        viewer.onFrame(current.lastFrame);
      } catch {
        // ignore
      }
    }
    if (fresh) {
      startWatching(pageId, current, restore).catch((error: unknown) => {
        if (streams.get(pageId) === current) endEntry(pageId, 'error', error instanceof Error ? error.message : undefined);
      });
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      current.viewers.delete(viewer);
      if (current.viewers.size > 0 || streams.get(pageId) !== current) return;
      streams.delete(pageId);
      current.unwatch?.();
      current.unwatch = null;
    };
  }

  function stopAll(): void {
    // Ends every picture as `stopped` through the driver's exit event.
    driver?.stop();
    for (const pageId of [...streams.keys()]) endEntry(pageId, 'stopped');
    listCache = null;
  }

  return {
    listWindows,
    isLoaded: () => Boolean(driver?.isRunning()),
    canRestore,
    openPage,
    closePage,
    command,
    input,
    subscribe,
    activeStreams: () => streams.size,
    stopAll,
  };
}

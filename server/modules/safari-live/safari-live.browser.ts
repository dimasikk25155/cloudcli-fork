/**
 * Driver of the `neo3-browser serve` helper (protocol: interfaces.md part 2 §A).
 *
 * - Lazy: nothing runs until the first `request`/`watch`; one process for all pages.
 * - Unload: no pending requests, no viewers and no real use for `idleMs` → `stop()`.
 *   Passive requests (status polls) do not count as use, so an open tab with a
 *   paused picture never keeps the helper in memory.
 * - A dead helper rejects what was pending (`helper_exit`), reports `exit`, and the
 *   next call starts a new one.
 * - Frames go only to the viewers of their page. Command arguments (typed text,
 *   scripts) are never logged here.
 */

import type {
  BrowserDriver,
  BrowserDriverDeps,
  BrowserEvent,
  BrowserProcess,
  BrowserReply,
  BrowserRequestOptions,
} from './safari-live.types.js';

export class BrowserError extends Error {
  /** Helper error code (`no_page`, `bad_args`, `timeout`, `js_error`, `navigation_failed`, `no_element`) or a driver one (`helper_missing`, `helper_exit`). */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BrowserError';
    this.code = code;
  }
}

type Pending = {
  resolve: (reply: BrowserReply) => void;
  reject: (error: BrowserError) => void;
  timer: NodeJS.Timeout;
};

type Running = {
  process: BrowserProcess;
  pending: Map<number, Pending>;
  exited: boolean;
};

export function createBrowserDriver(deps: BrowserDriverDeps): BrowserDriver {
  const now = deps.now ?? Date.now;
  const idleMs = deps.idleMs ?? 120_000;
  const requestTimeoutMs = deps.requestTimeoutMs ?? 45_000;
  const watchFps = deps.watchFps ?? 3;

  let running: Running | null = null;
  let nextId = 0;
  let lastUse = now();
  let idleTimer: NodeJS.Timeout | null = null;
  const watchers = new Map<string, Set<(jpeg: Buffer) => void>>();
  const listeners = new Set<(event: BrowserEvent) => void>();

  function emit(event: BrowserEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // a broken listener must not take the driver down
      }
    }
  }

  function clearIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function busy(): boolean {
    return Boolean(running && running.pending.size > 0) || watchers.size > 0;
  }

  function scheduleIdle(): void {
    clearIdle();
    if (!running || busy()) return;
    const wait = Math.max(0, lastUse + idleMs - now());
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!running || busy()) return;
      if (now() - lastUse < idleMs) {
        scheduleIdle();
        return;
      }
      stop();
    }, wait);
    idleTimer.unref?.();
  }

  function rejectAll(state: Running, code: string, message: string): void {
    const pending = [...state.pending.values()];
    state.pending.clear();
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(new BrowserError(code, message));
    }
  }

  function handleLine(state: Running, line: string): void {
    if (running !== state) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;

    if (typeof message.event === 'string') {
      const page = typeof message.page === 'string' ? message.page : '';
      if (message.event === 'frame') {
        const viewers = watchers.get(page);
        if (!viewers || typeof message.jpeg !== 'string') return;
        const jpeg = Buffer.from(message.jpeg, 'base64');
        for (const viewer of [...viewers]) {
          try {
            viewer(jpeg);
          } catch {
            // ignore one broken viewer
          }
        }
        return;
      }
      if (message.event === 'navigated') {
        emit({ event: 'navigated', page, url: String(message.url ?? ''), title: String(message.title ?? '') });
      } else if (message.event === 'closed') {
        emit({ event: 'closed', page });
      }
      return;
    }

    const id = Number(message.id);
    const entry = state.pending.get(id);
    if (!entry) return;
    state.pending.delete(id);
    clearTimeout(entry.timer);
    if (message.ok === true) {
      const { id: _id, ok: _ok, ...reply } = message;
      entry.resolve(reply);
    } else {
      entry.reject(new BrowserError(String(message.error || 'error'), String(message.message || 'helper error')));
    }
    scheduleIdle();
  }

  function handleExit(state: Running, code: number | null): void {
    if (state.exited) return;
    state.exited = true;
    rejectAll(state, 'helper_exit', 'the browser helper exited');
    if (running !== state) return;
    running = null;
    watchers.clear();
    clearIdle();
    emit({ event: 'exit', reason: 'died', code });
  }

  function ensure(): Running {
    if (running) return running;
    let process: BrowserProcess;
    try {
      process = deps.spawnHelper();
    } catch (error) {
      throw new BrowserError('helper_missing', error instanceof Error && error.message ? error.message : 'the browser helper is not installed');
    }
    const state: Running = { process, pending: new Map(), exited: false };
    running = state;
    process.onLine((line) => handleLine(state, line));
    process.onExit((code) => handleExit(state, code));
    return state;
  }

  function send(state: Running, op: string, args: Record<string, unknown>, timeoutMs: number): Promise<BrowserReply> {
    nextId += 1;
    const id = nextId;
    return new Promise<BrowserReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (state.pending.delete(id)) {
          reject(new BrowserError('timeout', `no answer to ${op}`));
          scheduleIdle();
        }
      }, timeoutMs);
      timer.unref?.();
      state.pending.set(id, { resolve, reject, timer });
      try {
        state.process.write(JSON.stringify({ ...args, id, op }));
      } catch (error) {
        state.pending.delete(id);
        clearTimeout(timer);
        reject(new BrowserError('helper_exit', error instanceof Error ? error.message : 'write failed'));
      }
    });
  }

  function request(op: string, args: Record<string, unknown> = {}, options: BrowserRequestOptions = {}): Promise<BrowserReply> {
    let state: Running;
    try {
      state = ensure();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!options.passive) lastUse = now();
    clearIdle();
    return send(state, op, args, options.timeoutMs ?? requestTimeoutMs);
  }

  function watch(page: string, onFrame: (jpeg: Buffer) => void): () => void {
    let state: Running;
    try {
      state = ensure();
    } catch {
      return () => {};
    }
    lastUse = now();
    clearIdle();
    let viewers = watchers.get(page);
    if (!viewers) {
      viewers = new Set();
      watchers.set(page, viewers);
      send(state, 'watch', { page, fps: watchFps }, requestTimeoutMs).catch((error: unknown) => {
        // The page is not there: its viewers learn it like a closed page.
        if (error instanceof BrowserError && error.code === 'no_page' && running === state) emit({ event: 'closed', page });
      });
    }
    viewers.add(onFrame);
    const mine = viewers;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      mine.delete(onFrame);
      if (mine.size > 0 || watchers.get(page) !== mine) return;
      watchers.delete(page);
      lastUse = now();
      if (running === state) send(state, 'unwatch', { page }, requestTimeoutMs).catch(() => {});
      scheduleIdle();
    };
  }

  function stop(): void {
    clearIdle();
    const state = running;
    if (!state) return;
    running = null;
    watchers.clear();
    state.exited = true;
    rejectAll(state, 'helper_exit', 'the browser helper was stopped');
    try {
      state.process.kill();
    } catch {
      // already gone
    }
    emit({ event: 'exit', reason: 'stopped', code: null });
  }

  return {
    request,
    watch,
    onEvent(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    isRunning: () => running !== null,
    stop,
  };
}

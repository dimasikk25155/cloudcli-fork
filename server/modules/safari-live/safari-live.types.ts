/**
 * «Браузер вживую» (module `safari-live`): Neo3's own invisible WebKit browser.
 * The agent of a chat drives its page; the canvas tab shows it live.
 * Contract: `.autopilot/…/interfaces.md`, part 2 §B.
 */

/** One page of the helper (`chat-<sessionId>` for a chat's own page). Page size is fixed 1280×800. */
export type SafariWindow = { pageId: string; title: string; url: string; width: number; height: number };

/**
 * `unloaded` — the helper is not running (unloaded by itself, not by the agent closing the page)
 * and the chat has a binding: subscribing to the stream opens its last address again.
 */
export type SafariLiveState = 'ok' | 'unloaded' | 'no_permission' | 'unsupported' | 'error';

export type SafariWindowList = { state: SafariLiveState; windows: SafariWindow[]; message?: string };

export type SafariBinding = {
  sessionId: string;
  pageId: string;
  /** Last address of the page: reopened after the helper was unloaded. */
  url: string;
  title: string;
  boundBy: 'agent' | 'user';
  updatedAt: string;
};

/** `page_gone` — the page was closed or the helper died; `stopped` — the server stopped it. */
export type StreamEnd = 'page_gone' | 'error' | 'stopped';

/** `GET /api/safari-live/sessions/:sessionId` (mirrored in `src/types/app.ts`). */
export type SafariLiveView = {
  state: SafariLiveState;
  binding: SafariBinding | null;
  /** The bound page is open in the helper right now. */
  windowAlive: boolean;
  streamUrl: string | null;
  windows: SafariWindow[];
  message?: string;
};

export type SafariViewer = { onFrame(jpeg: Buffer): void; onEnd(end: StreamEnd, message?: string): void };

// ---- helper process and driver (`safari-live.browser.ts`) ----

/** The `neo3-browser serve` child as lines of text (the test seam is a fake of this). */
export type BrowserProcess = {
  /** One JSON command, without the newline. */
  write(line: string): void;
  onLine(cb: (line: string) => void): void;
  onExit(cb: (code: number | null, message?: string) => void): void;
  kill(): void;
};

export type BrowserEvent =
  | { event: 'navigated'; page: string; url: string; title: string }
  | { event: 'closed'; page: string }
  /** The process is gone: `stopped` by the driver (idle, `stop()`) or `died` by itself. */
  | { event: 'exit'; reason: 'stopped' | 'died'; code: number | null };

export type BrowserReply = Record<string, unknown>;

export type BrowserRequestOptions = {
  /** Does not count as use: a status poll must not keep the helper loaded. */
  passive?: boolean;
  timeoutMs?: number;
};

export type BrowserDriverDeps = {
  spawnHelper: () => BrowserProcess;
  now?: () => number;
  /** No requests and no viewers this long → the helper is stopped. Default 120 000 ms. */
  idleMs?: number;
  /** A reply later than this rejects with `timeout`. Default 45 000 ms. */
  requestTimeoutMs?: number;
  /** Frames per second asked from the helper for watched pages. Default 3. */
  watchFps?: number;
};

export type BrowserDriver = {
  /** Starts the helper if needed; rejects with `BrowserError` (`code` = helper error code). */
  request(op: string, args?: Record<string, unknown>, options?: BrowserRequestOptions): Promise<BrowserReply>;
  /** JPEG frames of one page; returns the unsubscribe function. */
  watch(page: string, onFrame: (jpeg: Buffer) => void): () => void;
  onEvent(cb: (event: BrowserEvent) => void): () => void;
  isRunning(): boolean;
  stop(): void;
};

// ---- service ----

/** Input of the user («Управлять»), page pixels 1280×800. */
export type BrowserInput = {
  kind: 'click' | 'move' | 'down' | 'up' | 'scroll' | 'key' | 'text';
  x?: number;
  y?: number;
  dy?: number;
  key?: string;
  text?: string;
};

export type OpenedPage = SafariWindow & { loading: boolean };

export type SafariLiveDeps = {
  driver?: BrowserDriver;
  /** Default `process.platform`; anything but `darwin` → `unsupported`, nothing is started. */
  platform?: NodeJS.Platform;
  /** Default true; false → `state:'error'` «помощник не установлен». */
  helperInstalled?: () => boolean;
  /** The page went to another address (link click, the user's input): keep the binding's last address. */
  onNavigated?: (pageId: string, url: string, title: string) => void;
  now?: () => number;
  /** `list` result is reused this long. Default 1 000 ms. */
  listCacheMs?: number;
};

export type SafariLiveService = {
  /** Open pages; never starts the helper (not running → no pages). */
  listWindows(): Promise<SafariWindowList>;
  /** The helper process is running. */
  isLoaded(): boolean;
  /**
   * The page may be reopened at its last address: the helper is unloaded (idle, died) and the
   * agent did not close this page itself (`closePage`; cleared by the next `openPage`).
   */
  canRestore(pageId: string): boolean;
  /** Creates the page if needed and goes to `url` (http/https). Throws `BrowserError`. */
  openPage(pageId: string, url: string): Promise<OpenedPage>;
  /** Closes the page; the last page without viewers unloads the helper at once. */
  closePage(pageId: string): Promise<{ closed: boolean; unloaded: boolean }>;
  /** `click|type|press|scroll|read|eval|wait|snapshot` on an open page. Throws `BrowserError`. */
  command(op: string, pageId: string, args?: Record<string, unknown>): Promise<BrowserReply>;
  /** The user's input; its content is never logged. Throws `BrowserError`. */
  input(pageId: string, input: BrowserInput): Promise<void>;
  /**
   * Live frames of a page; a new viewer gets the last frame at once. `restore.url`: the page
   * is not open and `canRestore` → it is opened there first. Returns the unsubscribe function.
   */
  subscribe(pageId: string, viewer: SafariViewer, restore?: { url: string }): () => void;
  activeStreams(): number;
  stopAll(): void;
};

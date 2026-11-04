/**
 * «Safari вживую»: live picture of the agent's Safari window on the Neo3
 * workbench canvas. Contract: `.autopilot/…/interfaces.md` §2.
 */

export type SafariWindow = { windowId: number; title: string; onScreen: boolean; width: number; height: number };

export type SafariLiveState = 'ok' | 'no_permission' | 'unsupported' | 'error';

export type SafariWindowList = { state: SafariLiveState; windows: SafariWindow[]; message?: string };

export type SafariBinding = {
  sessionId: string;
  windowId: number;
  title: string;
  boundBy: 'agent' | 'user';
  updatedAt: string;
};

export type StreamEnd = 'window_gone' | 'no_permission' | 'error' | 'stopped';

export type SafariRect = { x: number; y: number; width: number; height: number };

/** `GET /api/safari-live/sessions/:sessionId` (mirrored in `src/types/app.ts`). */
export type SafariLiveView = {
  state: SafariLiveState;
  binding: SafariBinding | null;
  windowAlive: boolean;
  streamUrl: string | null;
  windows: SafariWindow[];
  message?: string;
};

/** Long-lived `neo3-safari-capture display` child. */
export type DisplayProcess = {
  onReady(cb: (bounds: SafariRect) => void): void;
  onExit(cb: (code: number, message?: string) => void): void;
  stop(): void;
};

/** `neo3-safari-capture stream <windowId>` child. */
export type StreamProcess = {
  onFrame(cb: (jpeg: Buffer) => void): void;
  onExit(cb: (end: StreamEnd, message?: string) => void): void;
  stop(): void;
};

export type HelperResult = { code: number; stdout: string; stderr: string };

export type StreamOptions = { fps: number; maxWidth: number; quality: number };

export type SafariLiveDeps = {
  /** Default `process.platform`; anything but `darwin` → `unsupported`, nothing is started. */
  platform?: NodeJS.Platform;
  runList?: () => Promise<HelperResult>;
  spawnDisplay?: () => DisplayProcess;
  runPlace?: (windowId: number, rect: SafariRect) => Promise<HelperResult>;
  spawnStream?: (windowId: number, opts: StreamOptions) => StreamProcess;
  now?: () => number;
  /** No viewers this long → the stream process stops. Default 20 000 ms. */
  idleMs?: number;
  /** `list` result is reused this long. Default 2 000 ms. */
  listCacheMs?: number;
  /** `display` must report ready within this time. Default 20 000 ms. */
  displayReadyMs?: number;
};

export type SafariViewer = { onFrame(jpeg: Buffer): void; onEnd(end: StreamEnd, message?: string): void };

export type EnsureDisplayResult =
  | { ok: true; bounds: SafariRect }
  | { ok: false; state: SafariLiveState; message: string };

export type PlaceResult = { ok: boolean; end?: StreamEnd; message?: string };

export type SafariLiveService = {
  listWindows(): Promise<SafariWindowList>;
  /** Newest window = largest `windowId`; `titleContains` is case-insensitive. */
  pickWindow(titleContains?: string): Promise<{ window: SafariWindow | null; list: SafariWindowList }>;
  /** Returns the unsubscribe function. */
  subscribe(windowId: number, viewer: SafariViewer): () => void;
  /** One `display` process per server life; a dead one is recreated by the next call. */
  ensureDisplay(): Promise<EnsureDisplayResult>;
  /** Moves the window onto the virtual display, filling it. */
  placeOnDisplay(windowId: number): Promise<PlaceResult>;
  activeStreams(): number;
  stopAll(): void;
};

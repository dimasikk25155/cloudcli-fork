/**
 * «Не засыпать» (мод `modKeepAwake`): while at least one agent run is working,
 * macOS is kept awake by a child `caffeinate -i -w <server pid>` (the process
 * dies together with the server). Released 2 minutes after the last working
 * run ended, and after 3 hours without any new activity. Not macOS: nothing.
 */

import type { AttentionChange } from '@/modules/session-attention/index.js';

export const KEEP_AWAKE_RELEASE_MS = 2 * 60_000;
export const KEEP_AWAKE_MAX_IDLE_MS = 3 * 60 * 60_000;

/** The slice of a child process the service uses. */
export type KeepAwakeChild = {
  kill: (signal?: NodeJS.Signals) => unknown;
  on: (event: 'exit' | 'error', listener: () => void) => unknown;
};

export type KeepAwakeSpawn = (command: string, args: string[]) => KeepAwakeChild;

export type KeepAwakeOptions = {
  spawn: KeepAwakeSpawn;
  platform: NodeJS.Platform;
  now: () => number;
  /** Pid `caffeinate -w` waits for; the server's own by default. */
  pid?: number;
  /** Per-owner mod switch; the default is "on". */
  isModOn?: (userId: number | null) => boolean;
};

export function createKeepAwake(options: KeepAwakeOptions) {
  const { spawn, platform, now } = options;
  const pid = options.pid ?? process.pid;
  const isOn = options.isModOn ?? (() => true);
  const working = new Set<string>();
  let child: KeepAwakeChild | null = null;
  let lastActivityAt = now();
  let emptySince: number | null = null;
  let broken = false;

  function release(): void {
    const current = child;
    child = null;
    emptySince = null;
    if (current) {
      try {
        current.kill();
      } catch {
        // already gone
      }
    }
  }

  function acquire(): void {
    if (child || broken || platform !== 'darwin') return;
    try {
      const started = spawn('caffeinate', ['-i', '-w', String(pid)]);
      child = started;
      const gone = () => {
        if (child === started) child = null;
      };
      started.on('exit', gone);
      started.on('error', () => {
        // caffeinate missing: stay quiet and do not retry in a loop.
        broken = true;
        gone();
      });
    } catch {
      broken = true;
      child = null;
    }
  }

  return {
    /** A state transition of a session (`sessionAttention.onChange`). */
    onChange(change: Pick<AttentionChange, 'sessionId' | 'state' | 'userId'>): void {
      if (platform !== 'darwin') return;
      const on = isOn(change.userId);
      if (change.state === 'working' && on) {
        working.add(change.sessionId);
        lastActivityAt = now();
        emptySince = null;
        acquire();
        return;
      }
      working.delete(change.sessionId);
      lastActivityAt = now();
      if (working.size === 0 && child && emptySince === null) emptySince = now();
    },
    /** Called on a timer: applies the 2-minute release and the 3-hour limit. */
    tick(): void {
      if (!child) return;
      const time = now();
      if (time - lastActivityAt >= KEEP_AWAKE_MAX_IDLE_MS) {
        release();
        return;
      }
      if (working.size === 0 && emptySince !== null && time - emptySince >= KEEP_AWAKE_RELEASE_MS) release();
    },
    isHolding: () => child !== null,
    stop(): void {
      working.clear();
      release();
    },
  };
}

export type KeepAwakeService = ReturnType<typeof createKeepAwake>;

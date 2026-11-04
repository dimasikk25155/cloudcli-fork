/**
 * Production runners of the Swift helper `neo3-safari-capture`
 * (`scripts/safari-capture/`, protocol in its README and interfaces.md §1).
 *
 * Every child gets a stdin pipe: the helper exits when stdin closes, so a dead
 * Neo3 server never leaves a capture or the virtual display behind. The helper
 * inherits «Запись экрана» from the node process only as its child.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { HELPER_MISSING_CODE, SAFARI_TEXT, readHelperError } from './safari-live.service.js';
import type { DisplayProcess, HelperResult, SafariRect, StreamEnd, StreamOptions, StreamProcess } from './safari-live.types.js';

const RUN_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 2_000;
/** A JPEG frame above this is a broken stream, not a picture. */
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

/** Stable path: macOS keys the screen-recording grant to it (see spec). */
export function defaultHelperPath(): string {
  return process.env.NEO3_SAFARI_CAPTURE_BIN || path.join(os.homedir(), '.cloudcli', 'bin', 'neo3-safari-capture');
}

function rectArgs(rect: SafariRect): string[] {
  return ['--x', String(Math.round(rect.x)), '--y', String(Math.round(rect.y)),
    '--width', String(Math.round(rect.width)), '--height', String(Math.round(rect.height))];
}

function lastStderr(buffer: string, chunk: Buffer): string {
  const next = buffer + chunk.toString('utf8');
  return next.length > 8_192 ? next.slice(-8_192) : next;
}

/** Closes stdin (the helper's clean-exit signal), then SIGTERM, then SIGKILL. */
function stopChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.stdin?.end();
  } catch {
    // already closed
  }
  const term = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const kill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, STOP_GRACE_MS);
    kill.unref();
  }, STOP_GRACE_MS);
  term.unref();
}

function streamEndFor(code: number | null, stoppedByUs: boolean): StreamEnd {
  if (code === 0) return 'stopped';
  if (code === 3) return 'no_permission';
  if (code === 4) return 'window_gone';
  if (code === null && stoppedByUs) return 'stopped';
  return 'error';
}

export function createHelperRunners(bin: string = defaultHelperPath(), baseArgs: string[] = [], env: () => NodeJS.ProcessEnv = () => process.env) {
  const installed = () => existsSync(bin);

  function run(args: string[]): Promise<HelperResult> {
    if (!installed()) return Promise.resolve({ code: HELPER_MISSING_CODE, stdout: '', stderr: '' });
    return new Promise((resolve) => {
      execFile(bin, [...baseArgs, ...args], { timeout: RUN_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: env() }, (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
        const code = !failure ? 0 : typeof failure.code === 'number' ? failure.code : 1;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (failure && typeof failure.code !== 'number' ? failure.message : '') });
      });
    });
  }

  function start(args: string[]): ChildProcess {
    if (!installed()) throw new Error(SAFARI_TEXT.helperMissing);
    return spawn(bin, [...baseArgs, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: env() });
  }

  function spawnStream(windowId: number, opts: StreamOptions): StreamProcess {
    const child = start(['stream', String(windowId), '--fps', String(opts.fps), '--max-width', String(opts.maxWidth), '--quality', String(opts.quality)]);
    const frameCbs: Array<(jpeg: Buffer) => void> = [];
    const exitCbs: Array<(end: StreamEnd, message?: string) => void> = [];
    let pending: Buffer = Buffer.alloc(0);
    let stderr = '';
    let stoppedByUs = false;
    let ended = false;
    let broken = false;

    const finish = (end: StreamEnd, message?: string) => {
      if (ended) return;
      ended = true;
      for (const cb of exitCbs) cb(end, message);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (broken) return;
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= 4) {
        const size = pending.readUInt32BE(0);
        if (size === 0 || size > MAX_FRAME_BYTES) {
          broken = true;
          stopChild(child);
          return;
        }
        if (pending.length < 4 + size) break;
        const frame = Buffer.from(pending.subarray(4, 4 + size));
        pending = pending.subarray(4 + size);
        for (const cb of frameCbs) cb(frame);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = lastStderr(stderr, chunk); });
    child.stdin?.on('error', () => {});
    child.on('error', (error) => finish('error', error.message));
    child.on('close', (code) => {
      const end = broken ? 'error' : streamEndFor(code, stoppedByUs);
      finish(end, end === 'stopped' ? undefined : readHelperError(stderr).message);
    });

    return {
      onFrame: (cb) => { frameCbs.push(cb); },
      onExit: (cb) => { exitCbs.push(cb); },
      stop: () => {
        stoppedByUs = true;
        stopChild(child);
      },
    };
  }

  function spawnDisplay(): DisplayProcess {
    const child = start(['display']);
    const readyCbs: Array<(bounds: SafariRect) => void> = [];
    const exitCbs: Array<(code: number, message?: string) => void> = [];
    let line = '';
    let stderr = '';
    let ended = false;

    const finish = (code: number, message?: string) => {
      if (ended) return;
      ended = true;
      for (const cb of exitCbs) cb(code, message);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      line += chunk.toString('utf8');
      let newline = line.indexOf('\n');
      while (newline >= 0) {
        const text = line.slice(0, newline).trim();
        line = line.slice(newline + 1);
        newline = line.indexOf('\n');
        if (!text) continue;
        try {
          const parsed = JSON.parse(text) as { ready?: unknown; bounds?: Partial<SafariRect> };
          const bounds = parsed.bounds;
          if (parsed.ready === true && bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value))) {
            const rect = { x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height) };
            for (const cb of readyCbs) cb(rect);
          }
        } catch {
          // log line of the helper
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = lastStderr(stderr, chunk); });
    child.stdin?.on('error', () => {});
    child.on('error', (error) => finish(1, error.message));
    child.on('close', (code) => finish(code ?? 1, readHelperError(stderr).message));

    return {
      onReady: (cb) => { readyCbs.push(cb); },
      onExit: (cb) => { exitCbs.push(cb); },
      stop: () => stopChild(child),
    };
  }

  return {
    runList: () => run(['list']),
    runPlace: (windowId: number, rect: SafariRect) => run(['place', String(windowId), ...rectArgs(rect)]),
    runOpen: (url: string, windowId?: number) => run(['open', url, ...(windowId ? ['--window', String(windowId)] : [])]),
    spawnStream,
    spawnDisplay,
  };
}

/**
 * The production `neo3-browser serve` child (`scripts/neo3-browser/`).
 *
 * stdin is a pipe: the helper exits when it closes, so a dead Neo3 server never
 * leaves the browser behind. stderr carries diagnostics only (never command content).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { BrowserProcess } from './safari-live.types.js';

const STOP_GRACE_MS = 2_000;

export const HELPER_MISSING_TEXT = 'Браузер не установлен (scripts/neo3-browser/build.sh)';

/** `NEO3_BROWSER_BIN`, else `~/.cloudcli/bin/neo3-browser`. */
export function defaultHelperPath(): string {
  return process.env.NEO3_BROWSER_BIN || path.join(os.homedir(), '.cloudcli', 'bin', 'neo3-browser');
}

export function helperInstalled(bin: string = defaultHelperPath()): boolean {
  return existsSync(bin);
}

/** Starts `<bin> [...baseArgs] serve`. Throws when the binary is not there. */
export function spawnBrowserHelper(bin: string = defaultHelperPath(), baseArgs: string[] = [], env: NodeJS.ProcessEnv = process.env): BrowserProcess {
  if (!existsSync(bin)) throw new Error(HELPER_MISSING_TEXT);
  const child = spawn(bin, [...baseArgs, 'serve'], { stdio: ['pipe', 'pipe', 'pipe'], env });
  const lineCbs: Array<(line: string) => void> = [];
  const exitCbs: Array<(code: number | null, message?: string) => void> = [];
  let buffer = '';
  let stderr = '';
  let ended = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) for (const cb of lineCbs) cb(line);
      index = buffer.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4_096);
  });
  child.stdin.on('error', () => {});

  const finish = (code: number | null, message?: string) => {
    if (ended) return;
    ended = true;
    for (const cb of exitCbs) cb(code, message);
  };
  child.on('error', (error) => finish(null, error.message));
  child.on('close', (code) => finish(code, stderr.trim().split('\n').pop() || undefined));

  return {
    write(line) {
      if (ended || !child.stdin.writable) throw new Error('the browser helper is not running');
      child.stdin.write(`${line}\n`);
    },
    onLine: (cb) => { lineCbs.push(cb); },
    onExit: (cb) => { exitCbs.push(cb); },
    /** Closes stdin (the helper's clean exit), then SIGTERM, then SIGKILL. */
    kill() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.stdin.end();
      } catch {
        // already closed
      }
      const term = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill('SIGTERM');
        const hard = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, STOP_GRACE_MS);
        hard.unref();
      }, STOP_GRACE_MS);
      term.unref();
    },
  };
}

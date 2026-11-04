import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';

import type { DiagExec, DiagFs } from './diagnostics.types.js';

/** Real program runner: argument array, no shell, hard timeout, no output over 256 KB. */
export const realExec: DiagExec = (command, args, options) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: options?.timeoutMs ?? 8000, maxBuffer: 256 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const errorCode = (error as NodeJS.ErrnoException | null)?.code as unknown;
        // 127 = the program is not there (like a shell); null = killed or timed out.
        const code = !error ? 0 : errorCode === 'ENOENT' ? 127 : typeof errorCode === 'number' ? errorCode : null;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });

export const realFs: DiagFs = {
  readFile: (path) => fsp.readFile(path, 'utf8'),
  readdir: (path) => fsp.readdir(path),
  isDirectory: async (path) => {
    try {
      return (await fsp.stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
  exists: async (path) => {
    try {
      await fsp.access(path);
      return true;
    } catch {
      return false;
    }
  },
  realpath: (path) => fsp.realpath(path),
  fileSize: async (path) => {
    try {
      return (await fsp.stat(path)).size;
    } catch {
      return null;
    }
  },
};

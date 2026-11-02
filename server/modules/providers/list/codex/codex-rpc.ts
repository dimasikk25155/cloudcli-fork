import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

import { resolveBundledCodex } from '@/shared/codex-paths.js';

export type CodexReadRpcOptions = { spawnImpl?: typeof spawn; timeoutMs?: number };

/** A bounded read-only RPC, without prompts, threads or credential export. */
export function readCodexRpc(method: 'account/read' | 'account/rateLimits/read', params: object = {},
  { spawnImpl = spawn, timeoutMs = 12_000 }: CodexReadRpcOptions = {}): Promise<any | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      const cli = resolveBundledCodex();
      child = spawnImpl(cli.executablePath, ['app-server'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, PATH: [...cli.pathDirs, process.env.PATH ?? ''].join(path.delimiter) },
      });
    } catch { resolve(null); return; }
    if (!child.stdout || !child.stdin) { child.kill(); resolve(null); return; }
    const lines = readline.createInterface({ input: child.stdout });
    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin?.end();
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const send = (request: unknown) => {
      try { child.stdin?.write(`${JSON.stringify(request)}\n`); } catch { finish(null); }
    };
    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));
    child.stdin.on('error', () => finish(null));
    child.stdout.on('error', () => finish(null));
    lines.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        if (settled) return;
        if (response.id === 1) {
          if (response.error) return finish(null);
          send({ method: 'initialized', params: {} });
          send({ id: 2, method, params });
        } else if (response.id === 2) {
          finish(response.error ? null : response.result);
        }
      } catch { /* Never log protocol/account data. */ }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'neo3_status', title: 'Neo3', version: '1.0.0' } } });
  });
}

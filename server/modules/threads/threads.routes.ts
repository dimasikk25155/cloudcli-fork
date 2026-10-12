import express, { type Request, type Response } from 'express';

import { ThreadsError, threadsService } from '@/modules/threads/threads.service.js';

/**
 * `/api/threads/*` — called by the Neo3 threads MCP server (server/threads-mcp.ts)
 * from inside an engine process. No JWT: the thread token of the run is the
 * right to act (Bearer header), and the service re-checks the chat, the user
 * and the project access on every call. Mounted before any JWT middleware.
 */

function readBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match?.[1] ?? null;
}

const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip'];

function normalizeAddress(address: string | undefined | null): string {
  const value = (address ?? '').trim().toLowerCase();
  return value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
}

/**
 * Only engines on this machine call /api/threads: a loopback peer, or the
 * server's own address (Neo3 bound to one IP, e.g. Tailscale, is reached by
 * its own engines on that IP). Anything relayed by a proxy is refused — the
 * proxy's own connection would look local.
 */
export function isLocalThreadsRequest(request: {
  remoteAddress?: string | null;
  localAddress?: string | null;
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  if (PROXY_HEADERS.some((name) => request.headers[name] !== undefined)) {
    return false;
  }
  const remote = normalizeAddress(request.remoteAddress);
  if (!remote) return false;
  if (remote === '::1' || /^127\./.test(remote)) return true;
  return remote === normalizeAddress(request.localAddress);
}

export function createThreadsRoutes(service: Pick<typeof threadsService, 'callTool'> = threadsService) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!isLocalThreadsRequest({ remoteAddress: req.socket.remoteAddress, localAddress: req.socket.localAddress, headers: req.headers })) {
      res.status(403).json({ success: false, code: 'NOT_LOCAL', error: 'Треды доступны только движкам на этой машине' });
      return;
    }
    next();
  });

  router.post('/tools/:toolName', async (req: Request, res: Response) => {
    const token = readBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ success: false, code: 'TOKEN_REQUIRED', error: 'Нужен токен треда (NEO3_THREADS_TOKEN)' });
      return;
    }
    const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    try {
      const data = await service.callTool(token, String(req.params.toolName ?? ''), input);
      res.json({ success: true, data });
    } catch (error) {
      if (error instanceof ThreadsError) {
        res.status(error.status).json({ success: false, code: error.code, error: error.message });
        return;
      }
      console.error('[Threads] Tool failed', {
        tool: req.params.toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ success: false, code: 'THREAD_TOOL_FAILED', error: 'Инструмент тредов упал на сервере Neo3' });
    }
  });

  return router;
}

export default createThreadsRoutes();

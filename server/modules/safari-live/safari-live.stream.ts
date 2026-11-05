/**
 * `GET /sl/:token/stream` — the live picture of a browser page as MJPEG
 * (`multipart/x-mixed-replace`): the browser draws it in a plain `<img>`.
 * `<img>` sends no Authorization header, so the link carries a short JWT in
 * the path (same idea as the autopilot dashboard `/ap/:token/…`). The token is
 * issued only by the admin-only `GET /api/safari-live/sessions/:id`.
 */

import { createHmac } from 'node:crypto';

import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { appConfigDb, safariLiveBindingsDb } from '@/modules/database/index.js';
import { isModActive } from '@/shared/mods.js';

import { MOD_OFF, modOffMessage } from '../../../shared/mods.js';

import { safariLiveService } from './safari-live.runtime.js';
import type { SafariLiveService } from './safari-live.types.js';

const SCOPE = 'safari-live';
const BOUNDARY = 'neo3frame';
export const STREAM_TOKEN_TTL_SECONDS = 600;

/**
 * Own key derived from the app secret (env override, else the stored one), read on use.
 * The login check (`authenticateToken` / `authenticateWebSocket`) verifies with the app
 * secret itself, so a stream link can never pass as a login, and a login can never
 * open a stream. The viewer id also lives under `viewer`, not `userId`.
 */
function streamSecret(): string {
  const appSecret = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();
  return createHmac('sha256', appSecret).update('neo3-safari-live-stream-v1').digest('base64url');
}

/** `sessionId` — the chat whose tab shows the picture: pinged when the picture ends by itself. */
export type StreamTokenPayload = { userId: number; pageId: string; sessionId?: string };

export function signStreamToken(payload: StreamTokenPayload, ttlSeconds: number = STREAM_TOKEN_TTL_SECONDS): string {
  const claims: Record<string, unknown> = { scope: SCOPE, viewer: payload.userId, page: payload.pageId };
  if (payload.sessionId) claims.chat = payload.sessionId;
  return jwt.sign(claims, streamSecret(), { expiresIn: ttlSeconds, algorithm: 'HS256' });
}

export function readStreamToken(token: string): StreamTokenPayload | null {
  try {
    const payload = jwt.verify(String(token || ''), streamSecret(), { algorithms: ['HS256'] }) as Record<string, unknown>;
    if (!payload || payload.scope !== SCOPE) return null;
    const userId = Number(payload.viewer);
    const pageId = payload.page;
    if (!Number.isSafeInteger(userId) || userId <= 0 || typeof pageId !== 'string' || !pageId) return null;
    return typeof payload.chat === 'string' && payload.chat ? { userId, pageId, sessionId: payload.chat } : { userId, pageId };
  } catch {
    return null;
  }
}

export type StreamHandlerOptions = {
  service: SafariLiveService;
  modOn: (userId: unknown) => boolean;
  /**
   * The picture ended by itself (page closed, helper died): `safari_live_changed` to the
   * chat of the link, so the tab rereads at once (and reopens the last page).
   */
  notify?: (userId: number, sessionId: string) => void;
  /** Last address of the link's page from the chat's binding: an unloaded browser reopens it. */
  restoreUrl?: (payload: StreamTokenPayload) => string | null;
};

export function createSafariLiveStreamHandler(options: StreamHandlerOptions) {
  return function serveStream(req: Request, res: Response): void {
    const payload = readStreamToken(String(req.params.token ?? ''));
    if (!payload) {
      res.status(401).type('text/plain').set('Cache-Control', 'no-store').send('Ссылка на картинку браузера устарела');
      return;
    }
    if (!options.modOn(payload.userId)) {
      res.status(409).set('Cache-Control', 'no-store').json({
        success: false,
        error: { code: MOD_OFF, message: modOffMessage('modSafariLive') },
      });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${BOUNDARY}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'close');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.socket.setNoDelay?.(true);

    let closed = false;
    // A slow viewer skips frames instead of growing the buffer without limit.
    let waitingForDrain = false;
    let unsubscribe: () => void = () => {};
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
    };

    let restoreAt: string | null = null;
    try {
      restoreAt = options.restoreUrl?.(payload) ?? null;
    } catch {
      restoreAt = null;
    }
    unsubscribe = options.service.subscribe(payload.pageId, {
      onFrame(jpeg) {
        if (closed || waitingForDrain) return;
        const head = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`;
        const ok = res.write(Buffer.concat([Buffer.from(head, 'latin1'), jpeg, Buffer.from('\r\n', 'latin1')]));
        if (!ok) {
          waitingForDrain = true;
          res.once('drain', () => { waitingForDrain = false; });
        }
      },
      onEnd(end) {
        if (closed) return;
        close();
        res.end();
        if (end !== 'stopped' && payload.sessionId) {
          try {
            options.notify?.(payload.userId, payload.sessionId);
          } catch {
            // a failed ping must not break the response
          }
        }
      },
    }, restoreAt ? { url: restoreAt } : undefined);
    if (closed) unsubscribe();

    req.on('close', close);
    res.on('close', close);
  };
}

/** Production handler for `app.get('/sl/:token/stream', …)`. */
export const serveSafariLiveStream = createSafariLiveStreamHandler({
  service: safariLiveService,
  modOn: (userId) => isModActive(userId as number, 'modSafariLive'),
  // Only the chat's own binding of exactly this page gives an address.
  restoreUrl: (payload) => {
    if (!payload.sessionId) return null;
    const binding = safariLiveBindingsDb.get(payload.sessionId);
    return binding && binding.pageId === payload.pageId && binding.url ? binding.url : null;
  },
  // Lazy: the websocket module is big and imports half the server.
  notify: (userId, sessionId) => {
    void import('@/modules/websocket/index.js')
      .then(({ notifySafariLiveChanged }) => notifySafariLiveChanged(userId, sessionId))
      .catch(() => {});
  },
});

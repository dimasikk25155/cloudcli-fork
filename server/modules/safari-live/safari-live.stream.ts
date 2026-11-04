/**
 * `GET /sl/:token/stream` — the live picture as MJPEG
 * (`multipart/x-mixed-replace`): the browser draws it in a plain `<img>`.
 * `<img>` sends no Authorization header, so the link carries a short JWT in
 * the path (same idea as the autopilot dashboard `/ap/:token/…`). The token is
 * issued only by the admin-only `GET /api/safari-live/sessions/:id`.
 */

import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { appConfigDb } from '@/modules/database/index.js';
import { isModActive } from '@/shared/mods.js';

import { MOD_OFF, modOffMessage } from '../../../shared/mods.js';

import { safariLiveService } from './safari-live.runtime.js';
import type { SafariLiveService } from './safari-live.types.js';

const SCOPE = 'safari-live';
const BOUNDARY = 'neo3frame';
export const STREAM_TOKEN_TTL_SECONDS = 600;

/** Same secret as `server/middleware/auth.js` (env override, else the stored one); read on use. */
function jwtSecret(): string {
  return process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();
}

export type StreamTokenPayload = { userId: number; windowId: number };

export function signStreamToken(payload: StreamTokenPayload, ttlSeconds: number = STREAM_TOKEN_TTL_SECONDS): string {
  return jwt.sign({ scope: SCOPE, userId: payload.userId, windowId: payload.windowId }, jwtSecret(), { expiresIn: ttlSeconds });
}

export function readStreamToken(token: string): StreamTokenPayload | null {
  try {
    const payload = jwt.verify(String(token || ''), jwtSecret()) as Record<string, unknown>;
    if (!payload || payload.scope !== SCOPE) return null;
    const userId = Number(payload.userId);
    const windowId = Number(payload.windowId);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(windowId) || windowId <= 0) return null;
    return { userId, windowId };
  } catch {
    return null;
  }
}

export type StreamHandlerOptions = {
  service: SafariLiveService;
  modOn: (userId: unknown) => boolean;
};

export function createSafariLiveStreamHandler(options: StreamHandlerOptions) {
  return function serveStream(req: Request, res: Response): void {
    const payload = readStreamToken(String(req.params.token ?? ''));
    if (!payload) {
      res.status(401).type('text/plain').set('Cache-Control', 'no-store').send('Ссылка на картинку Safari устарела');
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

    unsubscribe = options.service.subscribe(payload.windowId, {
      onFrame(jpeg) {
        if (closed || waitingForDrain) return;
        const head = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`;
        const ok = res.write(Buffer.concat([Buffer.from(head, 'latin1'), jpeg, Buffer.from('\r\n', 'latin1')]));
        if (!ok) {
          waitingForDrain = true;
          res.once('drain', () => { waitingForDrain = false; });
        }
      },
      onEnd() {
        if (closed) return;
        close();
        res.end();
      },
    });
    if (closed) unsubscribe();

    req.on('close', close);
    res.on('close', close);
  };
}

/** Production handler for `app.get('/sl/:token/stream', …)`. */
export const serveSafariLiveStream = createSafariLiveStreamHandler({
  service: safariLiveService,
  modOn: (userId) => isModActive(userId as number, 'modSafariLive'),
});

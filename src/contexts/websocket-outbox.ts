/**
 * Holding area for websocket frames composed while the socket was down.
 *
 * Mobile is where this matters: opening the system file/photo picker from the
 * composer backgrounds the page, the browser kills (or half-kills) the socket,
 * and the `chat.send` that follows the upload used to be dropped with nothing
 * but a console warning — the message never reached the agent, while the chat
 * showed it as sent. Frames are parked here instead and replayed on reconnect.
 */

/**
 * How long a queued frame stays worth sending. A message composed minutes ago
 * (phone asleep in a pocket) must not suddenly fire off on a late reconnect.
 */
export const OUTBOX_TTL_MS = 60_000;

type OutboxEntry = { frame: unknown; queuedAt: number };

export class WebSocketOutbox {
  private entries: OutboxEntry[] = [];

  constructor(private readonly ttlMs: number = OUTBOX_TTL_MS) {}

  push(frame: unknown, now: number = Date.now()): void {
    this.entries.push({ frame, queuedAt: now });
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Hands every still-fresh frame to `send` in the order it was queued and
   * empties the outbox. Expired frames are discarded, not sent.
   */
  flush(send: (frame: unknown) => void, now: number = Date.now()): void {
    const pending = this.entries;
    this.entries = [];
    for (const entry of pending) {
      if (now - entry.queuedAt > this.ttlMs) {
        continue;
      }
      send(entry.frame);
    }
  }
}

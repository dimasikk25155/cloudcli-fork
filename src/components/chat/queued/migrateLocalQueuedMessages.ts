/**
 * One-time move of the old browser-side queue to the server.
 *
 * Before the queue lived on the server, a message typed during a turn sat in
 * localStorage under `queued_message_<sessionId>`. At start-up each such key is
 * PUT to the server and removed. A network error or a 5xx keeps the key for the
 * next start; a refusal that will never change (403/404: no access, no such
 * chat; a 401 keeps the key — the session may just have expired) or an empty message drops it. The server is the only sender from now on.
 */

export type MigrationStorage = {
  length: number;
  key: (index: number) => string | null;
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
};

export type MigratedMessage = { content: string; options?: Record<string, unknown>; images?: unknown[] };

export const LOCAL_QUEUE_KEY_PREFIX = 'queued_message_';

/** A refusal that will not change on retry. */
const FINAL_REFUSALS = new Set([400, 403, 404, 413]);

function parseStored(raw: string): MigratedMessage | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { content?: unknown }).content === 'string') {
      const { content, options, images } = parsed as { content: string; options?: unknown; images?: unknown };
      if (!content.trim()) return null;
      return {
        content,
        ...(options && typeof options === 'object' ? { options: options as Record<string, unknown> } : {}),
        ...(Array.isArray(images) && images.length > 0 ? { images } : {}),
      };
    }
  } catch {
    // Legacy format: the raw draft text itself.
  }
  return raw.trim() ? { content: raw } : null;
}

export async function migrateLocalQueuedMessages({
  storage,
  put,
}: {
  storage: MigrationStorage;
  put: (sessionId: string, message: MigratedMessage) => Promise<{ ok: boolean; status: number }>;
}): Promise<void> {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LOCAL_QUEUE_KEY_PREFIX) && key.length > LOCAL_QUEUE_KEY_PREFIX.length) keys.push(key);
  }

  for (const key of keys) {
    const raw = storage.getItem(key);
    const message = raw ? parseStored(raw) : null;
    if (!message) {
      storage.removeItem(key);
      continue;
    }
    try {
      const result = await put(key.slice(LOCAL_QUEUE_KEY_PREFIX.length), message);
      if (result.ok || FINAL_REFUSALS.has(result.status)) storage.removeItem(key);
    } catch {
      // Offline: the key stays, the next start tries again.
    }
  }
}

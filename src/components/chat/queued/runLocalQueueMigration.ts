import { migrateLocalQueuedMessages } from './migrateLocalQueuedMessages';
import { putQueuedMessage } from './queuedMessageApi';

let started = false;

/** The app-level start of `migrateLocalQueuedMessages` against the real storage and API; once per page. */
export async function runLocalQueueMigration(): Promise<void> {
  if (started || typeof window === 'undefined') return;
  started = true;
  try {
    await migrateLocalQueuedMessages({
      storage: window.localStorage,
      put: async (sessionId, message) => {
        try {
          await putQueuedMessage(sessionId, message);
          return { ok: true, status: 200 };
        } catch (error) {
          const status = (error as { status?: unknown }).status;
          if (typeof status === 'number') return { ok: false, status };
          throw error;
        }
      },
    });
  } catch {
    // Storage unavailable: nothing to move.
  }
}

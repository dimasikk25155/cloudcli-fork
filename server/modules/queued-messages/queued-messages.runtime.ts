/**
 * Production wiring of the message queue: the real table, the chat status
 * from «Ждут тебя» and the chat gateway. The gateway is handed in at startup
 * (`setQueuedSendControl`, from server/index.js) — importing it here would
 * pull the whole websocket module, and half the server with it, into every
 * importer of this one.
 */

import { sessionAttentionDb } from '@/modules/database/index.js';

import { createQueuedMessagesRoutes } from './queued-messages.routes.js';
import {
  createQueuedMessagesService,
  type QueueAttention,
  type QueuedMessagesService,
  type QueuedSendControl,
} from './queued-messages.service.js';

let control: QueuedSendControl | null = null;

/** The chat gateway (`createQueuedSendControl(chatDependencies)`); null detaches it (tests). */
export function setQueuedSendControl(next: QueuedSendControl | null): void {
  control = next;
}

const ATTENTION_STATES: ReadonlySet<string> = new Set(['working', 'waiting', 'done', 'failed']);

/** The chat's status row plus «the last turn was stopped», which the status itself does not keep. */
function readAttention(sessionId: string): QueueAttention | null {
  const row = sessionAttentionDb.get(sessionId);
  if (!row || !ATTENTION_STATES.has(row.state)) {
    return null;
  }
  return {
    state: row.state as QueueAttention['state'],
    stopped: control?.lastRunStopped(sessionId) ?? false,
  };
}

/**
 * The websocket module, loaded once and lazily: it is big and imports half the
 * server. A fresh `import()` for every frame went through the module loader
 * each time — with loader hooks on Node 22 that is a round trip to another
 * thread, so «очередь опустела» reached the tab ticks after the run events
 * sent later than it (24.11, сервер Мити: `chat-queue-run.test.ts` red there,
 * green on Node 24). After the first load every frame leaves in a microtask.
 */
let websocketModule: Promise<typeof import('@/modules/websocket/index.js')> | null = null;

export const queuedMessagesService: QueuedMessagesService = createQueuedMessagesService({
  sendAsUser: (input) => (control
    ? control.send(input)
    : { started: false, busy: false, error: 'Сервер ещё запускается — отправь сообщение чуть позже' }),
  getAttention: readAttention,
  isRunLive: (sessionId) => control?.isRunLive(sessionId) ?? false,
  runPhase: (sessionId) => control?.runPhase(sessionId) ?? null,
  checkSendLimit: async (input) => (await control?.sendLimit?.(input)) ?? null,
  abortRun: (sessionId, userId) => control?.abortRun(sessionId, userId) ?? false,
  notifyChanged: (sessionId) => {
    const loading = websocketModule ?? import('@/modules/websocket/index.js');
    websocketModule = loading;
    void loading
      .then(({ notifyQueuedMessageChanged }) => notifyQueuedMessageChanged(sessionId))
      .catch((error: unknown) => {
        // A failed load is not kept: the next frame tries again.
        if (websocketModule === loading) websocketModule = null;
        console.error('[QueuedMessages] frame failed', { sessionId, error: error instanceof Error ? error.message : String(error) });
      });
  },
});

export const queuedMessagesRoutes = createQueuedMessagesRoutes(queuedMessagesService);

/**
 * Listener for `sessionAttention.onChange`. The queue reacts on the next tick,
 * not inside the status change: a send starts a new run, which changes the
 * status again — the other listeners (push, Telegram, threads, auto-relay)
 * must first hear «готово» of the turn that ended, and the turn's own
 * `complete` must leave before the next run's events.
 */
export function queuedAttentionListener(
  service: Pick<QueuedMessagesService, 'handleAttentionChange'> = queuedMessagesService,
): (change: { sessionId: string }) => void {
  return (change) => {
    setImmediate(() => {
      void service.handleAttentionChange(change.sessionId);
    });
  };
}

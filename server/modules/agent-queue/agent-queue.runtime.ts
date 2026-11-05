/**
 * Боевые зависимости «Конвейера»: прогоны через runHeadlessPrompt, страж
 * 5-часового лимита Claude, пуш + Telegram владельцу, сторож раз в 5 с.
 * Логика — в agent-queue.service.ts (там же тесты на фейках).
 */

import { sendOwnerNotice } from '@/modules/notifications/index.js';

import { createAgentQueueService } from './agent-queue.service.js';
import { createAgentQueueRouter } from './agent-queue.routes.js';

export const QUEUE_NOTICE_CODE = 'queue.done';
const TICK_MS = 5_000;

export const agentQueueService = createAgentQueueService({
  notify: (notice) => sendOwnerNotice({
    userId: notice.userId,
    code: notice.code,
    title: notice.title,
    body: notice.body,
    meta: { queueId: notice.queueId },
    icon: '🏭',
  }),
});

export const agentQueueRoutes = createAgentQueueRouter({ service: agentQueueService });

let timer: NodeJS.Timeout | null = null;

/** Started in `server.listen`; `NEO3_AGENT_QUEUE_WATCH=off` keeps it still. */
export function startAgentQueueWatch(): void {
  if (timer || process.env.NEO3_AGENT_QUEUE_WATCH === 'off') return;
  // Items left «в работе» by the previous process go back to the queue.
  const recovered = agentQueueService.recoverOnBoot();
  if (recovered > 0) console.log(`[agent-queue] ${recovered} item(s) back in the queue after restart`);
  const once = () => {
    void agentQueueService.tick().catch((error) => {
      console.error('[agent-queue] tick failed', error instanceof Error ? error.message : String(error));
    });
  };
  timer = setInterval(once, TICK_MS);
  timer.unref?.();
  once();
}

export function stopAgentQueueWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

import { authenticatedFetch } from '../../../utils/api';

import { advisorStore } from './advisorStore';

type AdvisorBody = {
  data?: { answer?: string };
  error?: { message?: string } | string;
  message?: string;
} | null;

/**
 * One /advisor call: the question goes to Claude Opus (read-only) with the
 * chat's last messages. The result lands in the advisor store (the canvas tab
 * shows it) and is returned too. Never throws: a failure is the entry's error.
 */
export async function askAdvisor(
  sessionId: string,
  question: string,
): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  const id = advisorStore.start(sessionId, question);
  try {
    const response = await authenticatedFetch('/api/diagnostics/advisor', {
      method: 'POST',
      body: JSON.stringify({ sessionId, question }),
    });
    const body = (await response.json().catch(() => null)) as AdvisorBody;
    const answer = body?.data?.answer;
    if (!response.ok || !answer) {
      const error = body?.error;
      const message = (typeof error === 'object' && error?.message) || (typeof error === 'string' ? error : '') || body?.message
        || 'Советник не ответил. Попробуй позже.';
      throw new Error(message);
    }
    advisorStore.resolve(sessionId, id, answer);
    return { ok: true, answer };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Советник не ответил. Попробуй позже.';
    advisorStore.fail(sessionId, id, message);
    return { ok: false, error: message };
  }
}

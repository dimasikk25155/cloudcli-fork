import { authenticatedFetch } from '../../../utils/api';

/**
 * Secret guard «Убрать в .secrets.env»: resolves with the name the server used.
 * Shared by every place that sends text to the agent (composer, question panel).
 */
export const stashSecretRequest = async (name: string, value: string): Promise<string> => {
  const response = await authenticatedFetch('/api/secrets/stash', {
    method: 'POST',
    body: JSON.stringify({ name, value }),
  });
  let body: { name?: unknown; error?: unknown } | null = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body: the status below is enough.
  }
  if (!response.ok || typeof body?.name !== 'string') {
    throw new Error(typeof body?.error === 'string' ? body.error : `ошибка ${response.status}`);
  }
  return body.name;
};

import { authenticatedFetch } from '../../utils/api';

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof body?.error === 'string'
      ? body.error
      : body?.error?.message ?? body?.message;
    return typeof message === 'string' && message.trim() ? message : fallback;
  } catch {
    return fallback;
  }
}

/** Asks the server whether the note exists strictly inside the chat's project. */
export async function verifyHandoffFile(sessionId: string, handoffPath: string): Promise<string> {
  const response = await authenticatedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/relay-file`, {
    method: 'POST',
    body: JSON.stringify({ path: handoffPath }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Записку не проверить (${response.status})`));
  }
  const body = await response.json() as { ok?: boolean; absPath?: unknown };
  if (body?.ok !== true || typeof body.absPath !== 'string') {
    throw new Error('Записку не проверить');
  }
  return body.absPath;
}

/**
 * Creates the continuation chat: same project and engine, linked to its
 * parent as `relay` by the server (refused → nothing is created).
 */
export async function createRelaySession({ provider, projectPath, parentSessionId }: {
  provider: string;
  projectPath: string;
  parentSessionId: string;
}): Promise<string> {
  const response = await authenticatedFetch('/api/providers/sessions', {
    method: 'POST',
    body: JSON.stringify({ provider, projectPath, parentSessionId, relation: 'relay' }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Новый чат не создать (${response.status})`));
  }
  const body = await response.json() as { data?: { sessionId?: unknown } };
  const sessionId = body?.data?.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new Error('Сервер не вернул id нового чата');
  }
  return sessionId;
}

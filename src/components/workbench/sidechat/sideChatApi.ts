/**
 * «Спросить в стороне» / `/btw`: creates the side chat on the server and opens
 * it as a canvas tab of the parent chat. The parent's run is not touched.
 */
import { authenticatedFetch } from '../../../utils/api';
import { openWorkbenchTab } from '../useWorkbench';

import { sideChatStore, sideChatTabFor } from './sideChatModel';

export type SideChatCreated = {
  sessionId: string;
  parentSessionId: string;
  provider: string;
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
  title: string;
};

/** POST /api/sessions/:id/btw; throws an Error with the server's plain-words message. */
export async function askAside(parentSessionId: string, input: { question: string; quote?: string }): Promise<SideChatCreated> {
  const response = await authenticatedFetch(`/api/sessions/${encodeURIComponent(parentSessionId)}/btw`, {
    method: 'POST',
    body: JSON.stringify({ question: input.question, ...(input.quote ? { quote: input.quote } : {}) }),
  });
  const body = await response.json().catch(() => null) as
    | { data?: SideChatCreated; error?: { message?: string } | string; message?: string }
    | null;
  if (!response.ok || !body?.data) {
    const error = body?.error;
    const message = (typeof error === 'object' && error?.message) || body?.message || 'Побочный чат не создан';
    throw new Error(message);
  }
  const created = body.data;
  sideChatStore.setEngine(created.sessionId, {
    provider: created.provider,
    model: created.model,
    effort: created.effort,
    permissionMode: created.permissionMode,
  });
  // The chat on the canvas reads its mode chip from the per-session key, as
  // the main chat does: start it on the mode the side chat was created with.
  const modeKey = `permissionMode-${created.sessionId}`;
  if (created.permissionMode && typeof localStorage !== 'undefined' && !localStorage.getItem(modeKey)) {
    localStorage.setItem(modeKey, created.permissionMode);
  }
  return created;
}

/**
 * Opens the side chat as its own tab on the canvas on screen — the parent's,
 * or the host's when the parent itself is a chat inside a canvas tab (the
 * caller checked modWorkbench).
 */
export function openSideChatTab(canvasSessionId: string | null, created: { sessionId: string; title: string }): void {
  openWorkbenchTab(canvasSessionId, sideChatTabFor(created));
}

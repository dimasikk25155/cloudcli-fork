/**
 * Rules that keep two chats on one page apart: the chat and «Второй чат» on
 * the canvas are two ChatInterface instances sharing the window, the socket
 * and localStorage.
 */

/** Marker on the root of a chat rendered inside a canvas tab. */
export const EMBEDDED_CHAT_ROOT_SELECTOR = '[data-chat-root="embedded"]';
/** Marker on the canvas itself (WorkbenchCanvas). */
export const WORKBENCH_CANVAS_SELECTOR = '[data-workbench-canvas]';

/**
 * localStorage key of the composer draft. The main chat keeps the historic
 * per-project key; a chat on the canvas adds its session id, so its draft
 * never lands in (or wipes) the left one.
 */
export function draftStorageKey(projectId: string, sessionId: string | null | undefined): string {
  return sessionId ? `draft_input_${projectId}__${sessionId}` : `draft_input_${projectId}`;
}

type EscapeTarget = { closest?: (selector: string) => unknown } | null | undefined;
type EscapeRoot = { contains: (other: never) => boolean } | null | undefined;

/**
 * Should this chat treat the Escape press as "stop the model"?
 * - a chat on the canvas: only when the key was pressed inside it;
 * - the main chat: unless the key was pressed on the canvas (another chat or
 *   a canvas tab owns it) — Esc from anywhere else stops it, as before.
 */
export function isEscapeForInstance(target: unknown, root: EscapeRoot, embedded: boolean): boolean {
  const insideRoot = Boolean(root && target && root.contains(target as never));
  if (embedded) {
    return insideRoot;
  }
  if (insideRoot) {
    return true;
  }
  const element = target as EscapeTarget;
  const onCanvas = typeof element?.closest === 'function' && Boolean(element.closest(WORKBENCH_CANVAS_SELECTOR));
  return !onCanvas;
}

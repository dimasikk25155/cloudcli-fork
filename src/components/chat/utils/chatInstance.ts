/**
 * Rules that keep two chats on one page apart: the chat and «Второй чат» on
 * the canvas are two ChatInterface instances sharing the window, the socket
 * and localStorage.
 */

import { bindPendingWorkspaceHandoffs, cancelPendingWorkspaceHandoffs } from '../../agent-workspace/handoff';

/** Marker on the root of a chat rendered inside a canvas tab. */
export const EMBEDDED_CHAT_ROOT_SELECTOR = '[data-chat-root="embedded"]';
/** Marker on the root of any chat instance (`main` or `embedded`). */
export const CHAT_ROOT_SELECTOR = '[data-chat-root]';
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
 * Which chat the last pointerdown landed in (its React tree, portaled menus
 * included). A click on a chat's feed leaves focus on <body>; the chat clicked
 * last owns an Esc pressed there.
 */
export function createPointerOwner() {
  let owner: string | null = null;
  return {
    claim(instanceId: string): void {
      owner = instanceId;
    },
    release(): void {
      owner = null;
    },
    current(): string | null {
      return owner;
    },
  };
}

/** One per page: every chat instance on it shares it. */
export const chatPointerOwner = createPointerOwner();

/**
 * Should this chat treat the Escape press as "stop the model"?
 * - the key was pressed inside this chat: yes;
 * - inside another chat, or on the canvas outside this chat (a canvas tab): no;
 * - anywhere else (body, a portaled menu): the chat that got the last
 *   pointerdown; nobody got it → the main chat, as before.
 */
export function isEscapeForInstance(
  target: unknown,
  root: EscapeRoot,
  embedded: boolean,
  pointer?: { self: string; owner: string | null },
): boolean {
  const insideRoot = Boolean(root && target && root.contains(target as never));
  if (insideRoot) {
    return true;
  }
  const element = target as EscapeTarget;
  const within = (selector: string) => typeof element?.closest === 'function' && Boolean(element.closest(selector));
  // Inside another chat, or on the canvas (a canvas tab owns it).
  if (within(CHAT_ROOT_SELECTOR) || within(WORKBENCH_CANVAS_SELECTOR)) {
    return false;
  }
  const owner = pointer?.owner ?? null;
  if (owner) {
    return owner === pointer?.self;
  }
  return !embedded;
}

type HandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Materials from «Отправить агенту» (workspace hand-offs): staged per project
 * into the main chat's draft. Only the main chat binds them on send or drops
 * them on cancel; a chat on the canvas leaves the project's list alone.
 */
export function workspaceHandoffsFor(embedded: boolean) {
  return {
    bindOnSend(projectId: string, sessionId: string, storage: HandoffStorage, bind: (grantId: string, sessionId: string) => Promise<unknown>): Promise<void> {
      if (embedded) return Promise.resolve();
      return bindPendingWorkspaceHandoffs(projectId, sessionId, storage, bind);
    },
    cancel(projectId: string, storage: Pick<Storage, 'removeItem'>): void {
      if (embedded) return;
      cancelPendingWorkspaceHandoffs(projectId, storage);
    },
  };
}

type VisibilityDocument = {
  visibilityState: string;
  addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
};

/**
 * Calls `onVisible` now if the page is shown, and every time it is shown
 * again (the tab comes back). Returns the unsubscribe.
 */
export function whenPageVisible(doc: VisibilityDocument | undefined, onVisible: () => void): () => void {
  if (!doc) {
    onVisible();
    return () => {};
  }
  const handle = () => {
    if (doc.visibilityState !== 'hidden') onVisible();
  };
  handle();
  doc.addEventListener('visibilitychange', handle);
  return () => doc.removeEventListener('visibilitychange', handle);
}

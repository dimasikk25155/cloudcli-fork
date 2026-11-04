/**
 * Связь холста с мостом в iframe правки. iframe — `sandbox="allow-scripts"`
 * без same-origin (origin непрозрачный), поэтому `postMessage(…, '*')`, а
 * доверие держится на трёх проверках входящего: окно-отправитель — именно
 * наш iframe, ключ сессии совпадает, форма проходит `validateBridgeMessage`.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { validateBridgeMessage, type BridgeToParent, type ParentToBridge } from './editorProtocol';

type Outgoing = ParentToBridge extends infer M ? (M extends unknown ? Omit<M, 'nonce'> : never) : never;

/** The message of a `message` event, if it is from our iframe window, with our nonce and of a valid shape. */
export function acceptBridgeMessage(event: { source: unknown; data: unknown }, frameWindow: unknown, nonce: string): BridgeToParent | null {
  if (!frameWindow || !nonce || event.source !== frameWindow) return null;
  return validateBridgeMessage(event.data, nonce);
}

/**
 * Listens to the bridge of `iframeRef` with `nonce` (null — not loaded yet)
 * and gives `post` to talk to it. `onMessage` may change on every render.
 */
export function useEditorBridge(input: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  nonce: string | null;
  onMessage: (message: BridgeToParent) => void;
}): { post: (message: Outgoing) => void } {
  const { iframeRef, nonce } = input;
  const handler = useRef(input.onMessage);
  handler.current = input.onMessage;

  useEffect(() => {
    if (!nonce) return undefined;
    const listen = (event: MessageEvent) => {
      const message = acceptBridgeMessage(event, iframeRef.current?.contentWindow ?? null, nonce);
      if (message) handler.current(message);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [iframeRef, nonce]);

  const post = useCallback((message: Outgoing) => {
    const target = iframeRef.current?.contentWindow;
    if (!target || !nonce) return;
    // The sandboxed frame has an opaque origin: '*' is the only target that reaches it; the nonce guards the content.
    target.postMessage({ ...message, nonce }, '*');
  }, [iframeRef, nonce]);

  return { post };
}

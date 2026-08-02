import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';

import { WebSocketOutbox } from './websocket-outbox';

/**
 * One frame received from the chat websocket. The server guarantees every
 * frame carries a `kind` (provider message kinds plus gateway kinds such as
 * `chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`). The synthetic `websocket_reconnected` kind is injected
 * client-side when the socket re-opens after a drop.
 */
export type ServerEvent = {
  kind?: string;
  type?: string;
  sessionId?: string;
  seq?: number;
  [key: string]: unknown;
};

type ServerEventListener = (event: ServerEvent) => void;

type WebSocketContextType = {
  ws: WebSocket | null;
  /**
   * Sends a frame, or queues it when the socket is not open (and kicks off an
   * immediate reconnect). Returns whether it went out on the wire right away.
   */
  sendMessage: (message: unknown) => boolean;
  /**
   * Subscribes to every websocket frame. Returns an unsubscribe function.
   *
   * This is the primary consumption API: events are dispatched synchronously
   * to every listener, so rapid back-to-back frames can never be coalesced or
   * dropped the way a single "latest message" state slot could.
   */
  subscribe: (listener: ServerEventListener) => () => void;
  /**
   * Legacy state-based access to the most recent frame.
   *
   * Kept only for low-frequency consumers (project/session broadcasts). High-rate
   * chat streams must use `subscribe` — React may batch state updates, which
   * makes `latestMessage` lossy under load.
   */
  latestMessage: ServerEvent | null;
  isConnected: boolean;
  /**
   * Timestamp (ms) of the last frame received on the socket. Browsers answer
   * server protocol pings invisibly to JS, so this is the only liveness
   * signal the client has: during an active run, prolonged silence means the
   * socket is half-open (mobile sleep, network blip) even though
   * `isConnected` still reads true.
   */
  getLastFrameAt: () => number;
  /**
   * Tears down the current socket (or a pending reconnect timer) and connects
   * again immediately, re-syncing consumers through `websocket_reconnected`.
   * Used by the chat watchdog when the socket looks dead or half-open.
   */
  forceReconnect: () => void;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false); // Track if component is unmounted
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  /**
   * Listener registry for the subscribe API. A ref (not state) because the
   * set must be readable synchronously inside `onmessage` and never trigger
   * re-renders of the provider tree.
   */
  const listenersRef = useRef(new Set<ServerEventListener>());
  const [latestMessage, setLatestMessage] = useState<ServerEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastFrameAtRef = useRef(0);
  /** Frames composed while the socket was down (see WebSocketOutbox). */
  const outboxRef = useRef(new WebSocketOutbox());
  const { token } = useAuth();

  const flushOutbox = useCallback((socket: WebSocket) => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    outboxRef.current.flush((frame) => socket.send(JSON.stringify(frame)));
  }, []);

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
    setLatestMessage(event);
  }, []);

  useEffect(() => {
    // The cleanup below sets unmountedRef = true. Without this reset, every
    // re-run of the effect (e.g. on token refresh) would short-circuit connect()
    // at its unmounted guard and leave the socket permanently disconnected.
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]); // everytime token changes, we reconnect

  const connect = useCallback(() => {
    if (unmountedRef.current) return; // Prevent connection if unmounted
    try {
      // Construct WebSocket URL
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');

      const websocket = new WebSocket(wsUrl);
      // Track the socket from creation (not from onopen) so forceReconnect
      // can also abort a socket that is stuck in CONNECTING.
      wsRef.current = websocket;

      websocket.onopen = () => {
        // A socket that was already superseded (an immediate reconnect started
        // while this one was still closing) must not touch shared state.
        if (wsRef.current !== websocket) {
          websocket.close();
          return;
        }
        setIsConnected(true);
        lastFrameAtRef.current = Date.now();
        if (hasConnectedRef.current) {
          // This is a reconnect — signal so components can catch up on missed messages
          dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
        }
        hasConnectedRef.current = true;
        // After the re-sync listeners above, so a replayed `chat.send` lands on
        // a session this client has already re-subscribed to.
        flushOutbox(websocket);
      };

      websocket.onmessage = (event) => {
        if (wsRef.current !== websocket) {
          return;
        }
        lastFrameAtRef.current = Date.now();
        try {
          const data = JSON.parse(event.data) as ServerEvent;
          dispatch(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        // The late close of a socket that has already been replaced must not
        // null out (or schedule a reconnect over) the live one.
        if (wsRef.current !== websocket) {
          return;
        }
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return; // Prevent reconnection if unmounted
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token, dispatch, flushOutbox]); // everytime token changes, we reconnect

  /**
   * Brings the socket back up now instead of waiting out the 3s reconnect
   * timer (which mobile browsers also suspend while the page is backgrounded).
   * A socket that is already OPEN or CONNECTING is left alone.
   */
  const reconnectNow = useCallback(() => {
    if (unmountedRef.current) {
      return;
    }
    const socket = wsRef.current;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    connect();
  }, [connect]);

  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    // Never drop the frame: park it and reconnect right away, so a message
    // composed over a socket the browser killed still reaches the server.
    outboxRef.current.push(message);
    console.warn('WebSocket not connected — frame queued until reconnect');
    reconnectNow();
    return false;
  }, [reconnectNow]);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getLastFrameAt = useCallback(() => lastFrameAtRef.current, []);

  const forceReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    const socket = wsRef.current;
    if (socket) {
      // Drop the reference before closing: the stale socket's late `onclose`
      // is then ignored instead of scheduling a competing reconnect.
      wsRef.current = null;
      socket.close();
    }
    // Straight back up rather than through the 3s timer (which mobile browsers
    // suspend in background tabs anyway) — callers ask for this precisely when
    // the connection is suspect and a send may be seconds away.
    reconnectNow();
  }, [reconnectNow]);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    subscribe,
    latestMessage,
    isConnected,
    getLastFrameAt,
    forceReconnect
  }), [sendMessage, subscribe, latestMessage, isConnected, getLastFrameAt, forceReconnect]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;

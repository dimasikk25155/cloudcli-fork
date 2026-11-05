import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';

import { authenticatedFetch } from '../../utils/api';

import { keyboardEventToInput, pointerToPagePoint, shouldSendMove, wheelToScrollDy } from './safariLiveModel';

type InputBody = { kind: 'down' | 'up' | 'move' | 'scroll' | 'key' | 'text'; x?: number; y?: number; dy?: number; key?: string; text?: string };

/** Не больше стольких запросов в полёте: лишние `move` отбрасываются, остальные ждут очереди. */
const MAX_PENDING_MOVES = 2;

/**
 * Ввод Димы в невидимый браузер («Управлять»): указатель, колесо и клавиатура уходят на
 * `POST /api/safari-live/sessions/:id/input` в координатах страницы 1280×800. Пока `enabled`,
 * ввод не доходит до Neo3 (`preventDefault`). Вводимый текст нигде не логируется.
 */
export function useBrowserInput(
  sessionId: string | null,
  enabled: boolean,
  imageRef: RefObject<HTMLImageElement | null>,
  surfaceRef: RefObject<HTMLDivElement | null>,
) {
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingMovesRef = useRef(0);
  const lastMoveAtRef = useRef<number | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  const send = useCallback(
    (body: InputBody) => {
      if (!sessionId) return;
      const url = `/api/safari-live/sessions/${encodeURIComponent(sessionId)}/input`;
      // Последовательно: порядок down → move → up важен.
      queueRef.current = queueRef.current
        .catch(() => undefined)
        .then(() =>
          authenticatedFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        )
        .catch(() => undefined);
    },
    [sessionId],
  );

  const toPagePoint = useCallback(
    (event: { clientX: number; clientY: number }, clamp: boolean) => {
      const image = imageRef.current;
      if (!image) return null;
      const rect = image.getBoundingClientRect();
      return pointerToPagePoint(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        { width: rect.width, height: rect.height },
        { width: image.naturalWidth, height: image.naturalHeight },
        { clamp },
      );
    },
    [imageRef],
  );

  // Колесо: React вешает его пассивным — `preventDefault` работает только у родного слушателя.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!enabled || !surface) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const point = toPagePoint(event, false);
      const dy = wheelToScrollDy(event.deltaY, event.deltaMode);
      if (!point || dy === 0) return;
      send({ kind: 'scroll', x: point.x, y: point.y, dy });
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [enabled, surfaceRef, toPagePoint, send]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      event.preventDefault();
      event.currentTarget.focus();
      const point = toPagePoint(event, false);
      if (!point) return;
      draggingRef.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Захват недоступен — перетаскивание за край просто оборвётся.
      }
      send({ kind: 'down', x: point.x, y: point.y });
    },
    [enabled, toPagePoint, send],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!enabled || !draggingRef.current) return;
      event.preventDefault();
      draggingRef.current = false;
      const point = toPagePoint(event, true);
      if (point) send({ kind: 'up', x: point.x, y: point.y });
    },
    [enabled, toPagePoint, send],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const now = Date.now();
      if (!shouldSendMove(lastMoveAtRef.current, now) || pendingMovesRef.current >= MAX_PENDING_MOVES) return;
      const point = toPagePoint(event, draggingRef.current);
      if (!point) return;
      const last = lastPointRef.current;
      if (last && last.x === point.x && last.y === point.y) return;
      lastMoveAtRef.current = now;
      lastPointRef.current = point;
      pendingMovesRef.current += 1;
      send({ kind: 'move', x: point.x, y: point.y });
      queueRef.current = queueRef.current.finally(() => {
        pendingMovesRef.current -= 1;
      });
    },
    [enabled, toPagePoint, send],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const input = keyboardEventToInput(event);
      if (!input) return;
      event.preventDefault();
      event.stopPropagation();
      send(input);
    },
    [enabled, send],
  );

  return { onPointerDown, onPointerUp, onPointerMove, onKeyDown };
}

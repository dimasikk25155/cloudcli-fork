/**
 * Масштаб холста правки: 25–400 %, шаги кнопок −/+, Cmd/Ctrl+колесо и
 * «Вписать». Масштаб применяется к iframe как `scale(zoom)`; рамки выделения
 * пересчитывает `docRectToScreen`.
 */

import type { EditorDocKind } from './editorModel';

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4] as const;

const EPSILON = 1e-6;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Next step up (`dir` 1) or down (-1) from any value; stays at the ends. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const value = clampZoom(current);
  if (dir > 0) return ZOOM_STEPS.find((step) => step > value + EPSILON) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((step) => step < value - EPSILON) ?? ZOOM_MIN;
}

/** Cmd/Ctrl+wheel (or a trackpad pinch): smooth, one notch ≈ ×1.4. */
export function wheelZoom(current: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampZoom(current);
  const delta = Math.max(-100, Math.min(100, deltaY));
  return clampZoom(clampZoom(current) * Math.exp(-delta / 300));
}

/**
 * «Вписать». `contentWidth/Height` — the document size the bridge measured in a
 * viewport `viewportWidth` px wide. SVG — the whole picture in the stage. HTML
 * that fills its viewport reflows to any width — 100 %; a fixed page wider
 * than its viewport — its width into the stage.
 */
export function fitZoom(input: {
  kind: EditorDocKind;
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  stageWidth: number;
  stageHeight: number;
}): number {
  const { kind, contentWidth, contentHeight, viewportWidth, stageWidth, stageHeight } = input;
  if (!(contentWidth > 0) || !(stageWidth > 0)) return 1;
  if (kind === 'svg') {
    const byHeight = contentHeight > 0 && stageHeight > 0 ? stageHeight / contentHeight : Infinity;
    return clampZoom(Math.min(stageWidth / contentWidth, byHeight));
  }
  if (contentWidth <= viewportWidth + 1) return 1;
  return clampZoom(stageWidth / contentWidth);
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)} %`;
}

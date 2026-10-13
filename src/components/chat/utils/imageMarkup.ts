/**
 * Marks drawn on an attached picture before it is sent: what a mark is, the
 * undo history, and how marks are painted onto a canvas. No DOM besides the
 * 2D context, so the history rules are testable in Node.
 *
 * Coordinates are in the picture's own pixels, so the saved file has the
 * marks exactly where they were drawn whatever the on-screen scale was.
 */

import { MAX_IMAGE_EDGE } from './imageDownscale';

export type MarkupTool = 'pen' | 'ellipse' | 'arrow' | 'text';

export type Point = { x: number; y: number };

export type MarkupShape =
  | { kind: 'pen'; color: string; width: number; points: Point[] }
  | { kind: 'ellipse'; color: string; width: number; from: Point; to: Point }
  | { kind: 'arrow'; color: string; width: number; from: Point; to: Point }
  | { kind: 'text'; color: string; size: number; at: Point; text: string };

/** Finished marks, oldest first. Never mutated: each step returns a new list. */
export type MarkupHistory = readonly MarkupShape[];

/** Smaller drags than this (in picture pixels) are taps, not ovals or arrows. */
const MIN_DRAG = 4;

const isMeaningful = (shape: MarkupShape): boolean => {
  switch (shape.kind) {
    case 'pen':
      return shape.points.length > 0;
    case 'ellipse':
      return Math.abs(shape.to.x - shape.from.x) >= MIN_DRAG && Math.abs(shape.to.y - shape.from.y) >= MIN_DRAG;
    case 'arrow':
      return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) >= MIN_DRAG;
    case 'text':
      return shape.text.trim().length > 0;
    default:
      return false;
  }
};

/** History with `shape` added; an accidental tap or empty text adds nothing. */
export function commitShape(history: MarkupHistory, shape: MarkupShape): MarkupHistory {
  return isMeaningful(shape) ? [...history, shape] : history;
}

/** History without its last mark. */
export function undoShape(history: MarkupHistory): MarkupHistory {
  return history.length > 0 ? history.slice(0, -1) : history;
}

/**
 * Name and type of the saved picture. Browsers encode PNG/JPEG/WebP; for
 * anything else `toBlob` silently produces PNG, and the name follows suit.
 */
export function markedFileIdentity(
  originalName: string,
  originalType: string,
  producedType: string,
): { name: string; type: string } {
  const type = producedType || originalType || 'image/png';
  if (type === originalType && originalName) {
    return { name: originalName, type };
  }
  const extension = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const base = (originalName || 'image').replace(/\.[A-Za-z0-9]{1,8}$/, '');
  return { name: `${base}.${extension}`, type };
}

/** Types `canvas.toBlob` reliably writes; anything else is saved as PNG. */
export const ENCODABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Canvas size for editing: the picture's own size, or scaled down to the same
 * long-edge limit uploads use — a 4000px camera shot would otherwise mean a
 * huge canvas on a phone, and the upload would shrink it anyway.
 */
export function markupCanvasSize(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_IMAGE_EDGE) {
    return { width, height };
  }
  const scale = MAX_IMAGE_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Line and font size that read well on this picture — a phone shot is ~1200px wide. */
export function markupScale(width: number, height: number): { lineWidth: number; fontSize: number } {
  const side = Math.max(1, Math.min(width, height));
  return {
    lineWidth: Math.max(3, Math.round(side * 0.006)),
    fontSize: Math.max(18, Math.round(side * 0.045)),
  };
}

const ARROW_HEAD_ANGLE = Math.PI / 7;

function drawArrow(ctx: CanvasRenderingContext2D, shape: Extract<MarkupShape, { kind: 'arrow' }>) {
  const { from, to, width } = shape;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const head = Math.min(length * 0.45, Math.max(width * 4.5, 14));
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  // Stop the shaft inside the head so the round cap does not poke through the tip.
  ctx.lineTo(to.x - Math.cos(angle) * head * 0.6, to.y - Math.sin(angle) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - ARROW_HEAD_ANGLE), to.y - head * Math.sin(angle - ARROW_HEAD_ANGLE));
  ctx.lineTo(to.x - head * Math.cos(angle + ARROW_HEAD_ANGLE), to.y - head * Math.sin(angle + ARROW_HEAD_ANGLE));
  ctx.closePath();
  ctx.fill();
}

/** Paint one mark. */
export function drawShape(ctx: CanvasRenderingContext2D, shape: MarkupShape) {
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (shape.kind) {
    case 'pen': {
      ctx.lineWidth = shape.width;
      const [first, ...rest] = shape.points;
      if (!first) break;
      if (rest.length === 0) {
        ctx.beginPath();
        ctx.arc(first.x, first.y, shape.width / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const point of rest) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      break;
    }
    case 'ellipse': {
      ctx.lineWidth = shape.width;
      const cx = (shape.from.x + shape.to.x) / 2;
      const cy = (shape.from.y + shape.to.y) / 2;
      const rx = Math.abs(shape.to.x - shape.from.x) / 2;
      const ry = Math.abs(shape.to.y - shape.from.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'arrow':
      ctx.lineWidth = shape.width;
      drawArrow(ctx, shape);
      break;
    case 'text': {
      ctx.font = `600 ${shape.size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = 'top';
      // A halo keeps the label readable on a busy screenshot: light behind
      // coloured text, dark behind white text.
      ctx.lineWidth = Math.max(3, shape.size / 6);
      ctx.strokeStyle = shape.color.toLowerCase() === '#ffffff' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.92)';
      const lines = shape.text.split('\n');
      lines.forEach((line, index) => {
        const y = shape.at.y + index * shape.size * 1.2;
        ctx.strokeText(line, shape.at.x, y);
        ctx.fillText(line, shape.at.x, y);
      });
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** The picture with every mark (and the one being drawn, if any) on top. */
export function renderMarkup(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  history: MarkupHistory,
  draft?: MarkupShape | null,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  for (const shape of history) {
    drawShape(ctx, shape);
  }
  if (draft) {
    drawShape(ctx, draft);
  }
}

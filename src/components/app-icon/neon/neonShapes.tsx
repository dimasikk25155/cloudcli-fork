/**
 * Простые формы для символов неоновых плиток (`neonGlyphs.tsx`): всё рисуется
 * `currentColor`, цвет слоя задаёт NeonTile. Сетка 100×100, линия 3 единицы.
 */
import React from 'react';

export const SW = 3;

type LineProps = { d: string; w?: number; o?: number; cap?: 'round' | 'butt' };
export function Line({ d, w = SW, o, cap = 'round' }: LineProps) {
  return (
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth={w}
      strokeLinecap={cap}
      strokeLinejoin="round"
      opacity={o}
    />
  );
}

/** Filled shape with softly rounded corners. */
export function Solid({ d, o, w = 1.6 }: { d: string; o?: number; w?: number }) {
  return (
    <path
      d={d}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={w}
      strokeLinejoin="round"
      opacity={o}
    />
  );
}

export function Fill({ d, o }: { d: string; o?: number }) {
  return <path d={d} fill="currentColor" opacity={o} />;
}

type BoxProps = { x: number; y: number; w: number; h: number; r: number; line?: number; o?: number };
/** Rounded rectangle: outlined when `line` is given, filled otherwise. */
export function Box({ x, y, w, h, r, line, o }: BoxProps) {
  return line ? (
    <rect x={x} y={y} width={w} height={h} rx={r} fill="none" stroke="currentColor" strokeWidth={line} opacity={o} />
  ) : (
    <rect x={x} y={y} width={w} height={h} rx={r} fill="currentColor" opacity={o} />
  );
}

export function Dot({ x, y, r, o }: { x: number; y: number; r: number; o?: number }) {
  return <circle cx={x} cy={y} r={r} fill="currentColor" opacity={o} />;
}

export function Ring({ x, y, r, w = SW }: { x: number; y: number; r: number; w?: number }) {
  return <circle cx={x} cy={y} r={r} fill="none" stroke="currentColor" strokeWidth={w} />;
}

export function Oval({ x, y, rx, ry, w }: { x: number; y: number; rx: number; ry: number; w?: number }) {
  return w ? (
    <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="none" stroke="currentColor" strokeWidth={w} />
  ) : (
    <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="currentColor" />
  );
}

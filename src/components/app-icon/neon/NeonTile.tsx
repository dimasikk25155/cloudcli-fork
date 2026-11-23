/**
 * Неоновая плитка в стиле аватарок ботов Neo³ (`bots-control/avatars`):
 * тёмный фон с радиальным свечением цвета проекта (центр чуть выше середины),
 * тонкое кольцо этого цвета по контуру скруглённого квадрата, крупный
 * двухцветный символ с мягким свечением и маленькая «3» в правом нижнем углу.
 * Всё — один `<svg>` 100×100. Разметка от темы не зависит: в тёмных темах
 * плитка рисуется как есть. Части помечены `data-neon-part`, цвет проекта
 * отдан в `--neon-accent` — светлая тема перекрашивает плитку своими
 * значениями (`--icon-tile-*`, правила `html:not(.dark) .neo3-neon` в
 * index.css): светлая основа, тёмный символ, акцент проекта на месте.
 */
import React, { useId } from 'react';
import type { CSSProperties } from 'react';

import type { AppIconSize } from '../AppIcon';

import { NEON_GLYPHS, type NeonGlyph } from './neonGlyphs';
import { NEON_BASE, NEON_WHITE, neonGlowTint } from './neonPalette';

export type NeonTileSize = AppIconSize | number;

/** `circle` — the round neon buttons of Home (settings next to the clock). */
export type NeonTileShape = 'squircle' | 'circle';

export type NeonTileProps = {
  glyph: NeonGlyph;
  accent: string;
  size?: NeonTileSize;
  /** The small «3» in the corner; by default only on tiles of 36 px and up. */
  showMark?: boolean;
  /** Squircle by default; `circle` for round buttons. */
  shape?: NeonTileShape;
  className?: string;
};

const NEON_TILE_PX: Record<AppIconSize, number> = { sm: 28, md: 40, lg: 68, dock: 56, touch: 52 };

/** Same rounding as `.neo3-squircle` (22.5%). */
const RADIUS = 22.5;
const MARK_MIN_PX = 36;
/** The bot symbols fill a circle; a squircle tile has room for a slightly larger one. */
const SYMBOL_SCALE = 1.04;
/** Under this size (no «3») the symbol is drawn larger still so it reads in the sidebar. */
const SMALL_PX = 32;
const SMALL_SYMBOL_SCALE = 1.24;

export default function NeonTile({ glyph, accent, size = 'lg', showMark, shape = 'squircle', className }: NeonTileProps) {
  const uid = `neon-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const px = typeof size === 'number' ? size : NEON_TILE_PX[size];
  const art = NEON_GLYPHS[glyph] ?? NEON_GLYPHS.folder;
  const mark = showMark ?? px >= MARK_MIN_PX;

  // About one device pixel at any size, so the ring never turns to mush or vanishes.
  const ringWidth = Math.min(4, Math.max(1.2, 110 / px));
  const ringInset = ringWidth / 2 + 1.4;
  const symbolScale = px < SMALL_PX ? SMALL_SYMBOL_SCALE : SYMBOL_SCALE;
  const radius = shape === 'circle' ? 50 : RADIUS;
  const ringRadius = shape === 'circle' ? 50 - ringInset : RADIUS - ringInset * 0.7;
  const glowId = `${uid}-glow`;
  const bgId = `${uid}-bg`;
  const cutId = `${uid}-cut`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={px}
      height={px}
      className={className}
      aria-hidden="true"
      focusable="false"
      data-neon-glyph={glyph}
      data-neon-shape={shape}
      style={{ '--neon-accent': accent } as CSSProperties}
    >
      <defs>
        <radialGradient id={bgId} cx="50" cy="41" r="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={neonGlowTint(accent)} data-neon-part="glow-core" />
          <stop offset="1" stopColor={NEON_BASE} data-neon-part="glow-edge" />
        </radialGradient>
        <filter
          id={glowId}
          x="0"
          y="0"
          width="100"
          height="100"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="blur" />
          <feFlood floodColor={accent} floodOpacity="0.7" />
          <feComposite in2="blur" operator="in" result="glow" />
          <feOffset in="SourceAlpha" dy="1" result="drop" />
          <feFlood floodColor="#000" floodOpacity="0.35" />
          <feComposite in2="drop" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {art.cut ? (
          <mask id={cutId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <rect width="100" height="100" fill="#fff" />
            <g color="#000">{art.cut}</g>
          </mask>
        ) : null}
      </defs>

      <rect width="100" height="100" rx={radius} fill={NEON_BASE} data-neon-part="base" />
      <rect width="100" height="100" rx={radius} fill={`url(#${bgId})`} />
      <rect
        x={ringInset}
        y={ringInset}
        width={100 - ringInset * 2}
        height={100 - ringInset * 2}
        rx={ringRadius}
        fill="none"
        stroke={accent}
        strokeOpacity="0.62"
        strokeWidth={ringWidth}
      />

      <g filter={`url(#${glowId})`}>
        <g transform={`translate(50 50) scale(${symbolScale}) translate(-50 -50)`}>
          <g mask={art.cut ? `url(#${cutId})` : undefined}>
            <g color={NEON_WHITE} data-neon-part="ink">{art.white}</g>
            <g color={accent} data-neon-part="accent">{art.accent}</g>
            {art.top ? <g color={NEON_WHITE} data-neon-part="ink">{art.top}</g> : null}
          </g>
        </g>
      </g>

      {mark ? (
        <text
          x="81.5"
          y="87"
          fill={NEON_WHITE}
          fontSize="11.5"
          fontWeight="700"
          textAnchor="middle"
          fontFamily="-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif"
          data-neon-part="mark"
        >
          3
        </text>
      ) : null}
    </svg>
  );
}

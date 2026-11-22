/**
 * Значок проекта: неоновая плитка в стиле аватарок ботов Neo³ (`neon/`),
 * а если Дима поставил свою картинку (долгое нажатие на «Домой») — она.
 * Жёлтая точка в углу — проект закреплён. Плитка тёмная в любой теме.
 */
import React from 'react';

import { cn } from '../../lib/utils';

import NeonTile from './neon/NeonTile';
import type { NeonGlyph } from './neon/neonGlyphs';

const SIZE = {
  sm: 'h-7 w-7',
  md: 'h-10 w-10',
  lg: 'h-[4.25rem] w-[4.25rem]',
  dock: 'h-14 w-14',
} as const;

export type AppIconSize = keyof typeof SIZE;

type AppIconProps = {
  glyph: NeonGlyph;
  accent: string;
  src?: string | null;
  size?: AppIconSize;
  starred?: boolean;
  className?: string;
};

export default function AppIcon({
  glyph,
  accent,
  src = null,
  size = 'lg',
  starred = false,
  className,
}: AppIconProps) {
  return (
    <span
      className={cn(
        src ? 'neo3-squircle' : 'neo3-neon',
        'relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden',
        SIZE[size],
        className,
      )}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <NeonTile glyph={glyph} accent={accent} size={size} showMark={size !== 'sm'} className="h-full w-full" />
      )}
      {starred && (
        <span className="absolute right-0.5 top-0.5 z-[2] h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
      )}
    </span>
  );
}

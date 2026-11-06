/**
 * Плитка пункта меню: iOS-«скругление» (глянец и тень — `.neo3-squircle` в
 * `src/index.css`), яркий градиент «Новой вкладки» и свой рисунок поверх.
 * Плитка яркая сама по себе — одинакова в светлой и тёмной теме.
 */
import React from 'react';

import { cn } from '../../lib/utils';
import PixelCrab from '../crabs/PixelCrab';

import MenuIconArt from './MenuIconArt';
import { menuTileFor, type MenuIconKey } from './menuIconModel';

export type MenuTileSize = 'sm' | 'md' | 'lg';

const SIZE: Record<MenuTileSize, { box: string; icon: string; crab: number }> = {
  sm: { box: 'h-7 w-7', icon: 'h-4 w-4', crab: 1 },
  md: { box: 'h-10 w-10', icon: 'h-[1.375rem] w-[1.375rem]', crab: 1.5 },
  lg: { box: 'h-[3.25rem] w-[3.25rem]', icon: 'h-7 w-7', crab: 2 },
};

export type MenuTileProps = {
  iconKey: MenuIconKey;
  size?: MenuTileSize;
  className?: string;
};

export default function MenuTile({ iconKey, size = 'sm', className }: MenuTileProps) {
  const dimensions = SIZE[size];
  return (
    <span
      className={cn(
        'neo3-squircle relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden',
        dimensions.box,
        className,
      )}
      style={{ background: menuTileFor(iconKey).gradient }}
      data-menu-tile={iconKey}
      aria-hidden="true"
    >
      {iconKey === 'krabik' ? (
        // White crab: the sprite's own orange would vanish on the orange tile.
        <PixelCrab
          tint="sonnet"
          state="done"
          scale={dimensions.crab}
          className="relative z-[2] !text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)] [&>span:last-child]:hidden"
        />
      ) : (
        <MenuIconArt
          iconKey={iconKey}
          className={cn('relative z-[2] drop-shadow-[0_1px_1px_rgba(0,0,0,0.22)]', dimensions.icon)}
        />
      )}
    </span>
  );
}

/**
 * Пункты складки «Меню» внизу сайдбара в двух видах: `list` — строки
 * компьютера (маленькая плитка + полное имя), `grid` — сетка телефона по 4
 * крупные плитки с подписью под ними, как «Новая вкладка». Без хуков: что
 * показывать и в каком порядке, решает SidebarFooter.
 */
import React from 'react';

import { LAUNCHER_GRADIENTS } from '../../../workbench/newTabModel';
import MenuTile from '../../../menu-icons/MenuTile';
import { isMenuIconKey } from '../../../menu-icons/menuIconModel';

export type SidebarMenuItem = { key: string; label: string; onClick: () => void };

type SidebarMenuItemsProps = {
  items: SidebarMenuItem[];
  variant: 'list' | 'grid';
  overdueCount: number;
};

const NEUTRAL_SIZE: Record<'sm' | 'lg', string> = {
  sm: 'h-7 w-7 text-[11px]',
  lg: 'h-[3.25rem] w-[3.25rem] text-xl',
};

/** A tile for an entry this build has no picture for (a plugin, a new panel). */
function NeutralTile({ label, size }: { label: string; size: 'sm' | 'lg' }) {
  return (
    <span
      className={`neo3-squircle relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden font-semibold text-white ${NEUTRAL_SIZE[size]}`}
      style={{ background: LAUNCHER_GRADIENTS.gray }}
      aria-hidden="true"
    >
      <span className="relative z-[2]">{label.trim()[0]?.toUpperCase() ?? '?'}</span>
    </span>
  );
}

/**
 * The same red dot as consigliere's `CountDot`, drawn here so this component
 * renders without a JSX runtime import from that module (node render tests).
 */
function OverdueDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1 -top-1 z-[3] flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white">
      {count > 9 ? '9+' : count}
    </span>
  );
}

function ItemTile({ item, size, overdueCount }: { item: SidebarMenuItem; size: 'sm' | 'lg'; overdueCount: number }) {
  return (
    <span className="relative inline-flex">
      {isMenuIconKey(item.key) ? <MenuTile iconKey={item.key} size={size} /> : <NeutralTile label={item.label} size={size} />}
      {item.key === 'consigliere' && <OverdueDot count={overdueCount} />}
    </span>
  );
}

export default function SidebarMenuItems({ items, variant, overdueCount }: SidebarMenuItemsProps) {
  if (variant === 'grid') {
    return (
      <div className="grid grid-cols-4 gap-x-1 gap-y-3 px-1 pb-1 pt-2">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className="sidebar-footer-item flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-0.5 pb-1 pt-1.5 outline-none transition-transform [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94] motion-reduce:transition-none"
            onClick={item.onClick}
            aria-label={item.label}
            title={item.label}
          >
            <ItemTile item={item} size="lg" overdueCount={overdueCount} />
            <span className="line-clamp-2 w-full break-words text-center text-[11px] leading-tight text-foreground/90">
              {item.label}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="sidebar-footer-item flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={item.onClick}
        >
          <ItemTile item={item} size="sm" overdueCount={overdueCount} />
          <span className="text-sm">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

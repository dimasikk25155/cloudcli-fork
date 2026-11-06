/**
 * Свои пиктограммы меню Neo3 — не lucide и не системные эмодзи: на айфоне,
 * маке и Android они выглядят одинаково. Сетка 24×24, белые крупные формы
 * плюс полупрозрачные белые детали; прорези (окна, глаза, стрелки часов)
 * вырезаны маской, сквозь них виден цвет плитки. Рисунок рассчитан на 16 px.
 */
import React, { useId, type ReactNode } from 'react';

import type { MenuIconKey } from './menuIconModel';

type ArtKey = Exclude<MenuIconKey, 'krabik'>;

const W = '#fff';
/** Secondary tone: details that sit behind or inside the main shape. */
const SOFT = 0.55;
/** In a mask: black cuts a hole, grey leaves the shape half transparent. */
const CUT = '#000';
const HALF = '#7a7a7a';

/** A mask over the whole canvas: everything shows except what `children` paint dark. */
function Mask({ id, children }: { id: string; children: ReactNode }) {
  return (
    <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <rect width="24" height="24" fill={W} />
      {children}
    </mask>
  );
}

const ART: Record<ArtKey, (id: string) => ReactNode> = {
  // Системные задачи: планшет с галочками и месяц — то, что делается ночью.
  nightshift: (id) => (
    <>
      <Mask id={`${id}a`}>
        <circle cx="18" cy="6.4" r="6.6" fill={CUT} />
      </Mask>
      <Mask id={`${id}b`}>
        <circle cx="20.9" cy="3.6" r="4.3" fill={CUT} />
      </Mask>
      <g mask={`url(#${id}a)`}>
        <rect x="2.4" y="5" width="14" height="16.6" rx="2.8" fill={W} fillOpacity={0.6} />
        <rect x="5.9" y="3" width="7" height="4.2" rx="1.6" fill={W} />
      </g>
      <path
        d="M5.6 12.6l1.9 1.9 3.4-3.6M5.6 17.9l1.9 1.9 3.4-3.6"
        fill="none"
        stroke={W}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="6.4" r="5.1" fill={W} mask={`url(#${id}b)`} />
    </>
  ),

  // Канцелярия: кошелёк, из которого торчат бумаги.
  consigliere: (id) => (
    <>
      <Mask id={`${id}a`}>
        <rect x="14.2" y="11.6" width="9" height="5.6" rx="2.8" fill={CUT} />
      </Mask>
      <rect x="5" y="2.6" width="10.5" height="9" rx="1.4" fill={W} fillOpacity={SOFT} transform="rotate(-10 10.25 7.1)" />
      <rect x="9.5" y="3.4" width="9.5" height="8" rx="1.4" fill={W} fillOpacity={SOFT} transform="rotate(8 14.25 7.4)" />
      <rect x="2" y="8" width="20" height="13" rx="3.2" fill={W} mask={`url(#${id}a)`} />
      <rect x="15.6" y="12.9" width="6.4" height="3" rx="1.5" fill={W} fillOpacity={SOFT} />
      <circle cx="17.4" cy="14.4" r="1.15" fill={W} />
    </>
  ),

  // Мазда: машина сбоку — кузов, стёкла, колёса в арках.
  mazda: (id) => (
    <>
      <Mask id={`${id}a`}>
        <circle cx="7" cy="17" r="4" fill={CUT} />
        <circle cx="17" cy="17" r="4" fill={CUT} />
        <path d="M9.4 10.9l1.9-3.5h2.4v3.5ZM15.1 7.4h1l2.5 3.5h-3.5Z" fill={HALF} />
      </Mask>
      <path
        d="M2 13.8c0-1.6 1.1-2.7 2.7-2.9l2.6-.4 2.4-4.1c.4-.6 1-1 1.7-1h5.1c.7 0 1.3.3 1.7.9l2.9 4.2c1.6.3 2.9 1.4 2.9 3.1v1.9c0 .8-.6 1.5-1.4 1.5H3.4c-.8 0-1.4-.7-1.4-1.5Z"
        fill={W}
        mask={`url(#${id}a)`}
      />
      <circle cx="7" cy="17" r="2.9" fill={W} />
      <circle cx="17" cy="17" r="2.9" fill={W} />
    </>
  ),

  // Рабочее пространство: окно, разбитое на панели.
  'agent-workspace': (id) => (
    <>
      <Mask id={`${id}a`}>
        <rect x="4.4" y="8.4" width="6.8" height="10.2" rx="1.3" fill={CUT} />
        <rect x="12.9" y="8.4" width="6.7" height="4.2" rx="1.2" fill={CUT} />
        <rect x="12.9" y="14.4" width="6.7" height="4.2" rx="1.2" fill={CUT} />
      </Mask>
      <rect x="2.4" y="3.4" width="19.2" height="17.2" rx="3.2" fill={W} mask={`url(#${id}a)`} />
      <rect x="4.4" y="8.4" width="6.8" height="10.2" rx="1.3" fill={W} fillOpacity={SOFT} />
    </>
  ),

  // Расписания: календарь и часы поверх него.
  schedules: (id) => (
    <>
      <Mask id={`${id}a`}>
        <circle cx="16.6" cy="16.6" r="7.2" fill={CUT} />
      </Mask>
      <Mask id={`${id}b`}>
        <path d="M16.6 13.3v3.6l2.4 1.6" fill="none" stroke={CUT} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </Mask>
      <g mask={`url(#${id}a)`}>
        <rect x="2" y="4.6" width="15.4" height="14.6" rx="2.7" fill={W} fillOpacity={SOFT} />
        <path d="M2 7.3a2.7 2.7 0 0 1 2.7-2.7h10a2.7 2.7 0 0 1 2.7 2.7v2.2H2Z" fill={W} />
      </g>
      <rect x="5.2" y="2.4" width="2.1" height="4.4" rx="1.05" fill={W} />
      <rect x="12.1" y="2.4" width="2.1" height="4.4" rx="1.05" fill={W} />
      <circle cx="16.6" cy="16.6" r="5.6" fill={W} mask={`url(#${id}b)`} />
    </>
  ),

  // Сценарии: блоки, связанные стрелками, — схема шагов.
  pipelines: () => (
    <>
      <path
        d="M10.2 6.2h3.4M6.2 10.2v5.4c0 1.2.9 2.1 2.1 2.1h4.4"
        fill="none"
        stroke={W}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M11.6 14.6l3.1 3.1-3.1 3.1" fill="none" stroke={W} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2.2" y="2.2" width="8" height="8" rx="2.3" fill={W} />
      <circle cx="18" cy="6.2" r="3.9" fill={W} fillOpacity={SOFT} />
      <rect x="14.6" y="13.7" width="7.6" height="7.6" rx="2.2" fill={W} />
    </>
  ),

  // Аудит и деньги: щит с галочкой и монета.
  governance: (id) => (
    <>
      <Mask id={`${id}a`}>
        <circle cx="17.3" cy="16.9" r="6.6" fill={CUT} />
      </Mask>
      <Mask id={`${id}b`}>
        <path
          d="M16 20v-6.1h2a1.75 1.75 0 0 1 0 3.5h-3M14.7 18.6h3.2"
          fill="none"
          stroke={CUT}
          strokeWidth="1.45"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Mask>
      <g mask={`url(#${id}a)`}>
        <path d="M10 1.8l7.4 2.7v6.4c0 4.8-3.1 8.6-7.4 10.5-4.3-1.9-7.4-5.7-7.4-10.5V4.5Z" fill={W} fillOpacity={SOFT} />
        <path d="M6.4 10.9l2.5 2.5 4.6-4.8" fill="none" stroke={W} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="17.3" cy="16.9" r="5.2" fill={W} mask={`url(#${id}b)`} />
    </>
  ),

  // Сервер: стойка из трёх блоков с огоньками.
  server: (id) => (
    <>
      <Mask id={`${id}a`}>
        {[3, 9.4, 15.8].map((y) => (
          <g key={y}>
            <circle cx="6.5" cy={y + 2.6} r="1.2" fill={CUT} />
            <rect x="10.6" y={y + 2} width="7.4" height="1.25" rx="0.62" fill={HALF} />
          </g>
        ))}
      </Mask>
      <g mask={`url(#${id}a)`}>
        <rect x="2.6" y="3" width="18.8" height="5.2" rx="1.8" fill={W} />
        <rect x="2.6" y="9.4" width="18.8" height="5.2" rx="1.8" fill={W} />
        <rect x="2.6" y="15.8" width="18.8" height="5.2" rx="1.8" fill={W} />
      </g>
    </>
  ),

  // Дуэт: две ноты под одним ребром — двое в паре; рядом звучат искры.
  duet: () => (
    <>
      <circle cx="4.2" cy="6.2" r="1.6" fill={W} fillOpacity={SOFT} />
      <circle cx="2.9" cy="11" r="1.05" fill={W} fillOpacity={SOFT} />
      <path d="M8.4 5.4l12.2-3.1v4.7L8.4 10.1Z" fill={W} />
      <rect x="8.4" y="6" width="2.1" height="12.2" fill={W} />
      <rect x="18.5" y="3" width="2.1" height="12.6" fill={W} />
      <ellipse cx="6.6" cy="18.1" rx="3.6" ry="2.8" transform="rotate(-20 6.6 18.1)" fill={W} />
      <ellipse cx="16.7" cy="15.5" rx="3.6" ry="2.8" transform="rotate(-20 16.7 15.5)" fill={W} />
    </>
  ),

  // Агенты: голова робота с антенной.
  agents: (id) => (
    <>
      <Mask id={`${id}a`}>
        <circle cx="8.9" cy="12.9" r="2" fill={CUT} />
        <circle cx="15.1" cy="12.9" r="2" fill={CUT} />
        <rect x="9" y="16.4" width="6" height="1.7" rx="0.85" fill={HALF} />
      </Mask>
      <rect x="11.05" y="3.6" width="1.9" height="4" fill={W} />
      <circle cx="12" cy="3.2" r="1.9" fill={W} />
      <rect x="1.4" y="10.8" width="2.6" height="5.6" rx="1.2" fill={W} fillOpacity={SOFT} />
      <rect x="20" y="10.8" width="2.6" height="5.6" rx="1.2" fill={W} fillOpacity={SOFT} />
      <rect x="4" y="7" width="16" height="14" rx="4" fill={W} mask={`url(#${id}a)`} />
    </>
  ),

  // Конвейер: лента с роликами и коробки на ней.
  queue: (id) => (
    <>
      <Mask id={`${id}a`}>
        {[5.2, 9.8, 14.4, 19].map((x) => (
          <circle key={x} cx={x} cy="18.2" r="1.35" fill={CUT} />
        ))}
      </Mask>
      <Mask id={`${id}b`}>
        <rect x="6.3" y="5.6" width="1.7" height="3.6" fill={HALF} />
      </Mask>
      <rect x="1.6" y="15" width="20.8" height="6.4" rx="3.2" fill={W} mask={`url(#${id}a)`} />
      <rect x="2.6" y="5.6" width="9" height="8" rx="1.5" fill={W} mask={`url(#${id}b)`} />
      <rect x="13.4" y="8.4" width="7.4" height="5.2" rx="1.3" fill={W} fillOpacity={SOFT} />
      <path d="M14.4 4.6h5.4m-2-2 2 2-2 2" fill="none" stroke={W} strokeOpacity={SOFT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  // Настройки: шестерёнка.
  settings: (id) => (
    <>
      <Mask id={`${id}a`}>
        <circle cx="12" cy="12" r="3.3" fill={CUT} />
      </Mask>
      <g mask={`url(#${id}a)`}>
        <circle cx="12" cy="12" r="7.3" fill={W} />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <rect key={angle} x="10" y="1.6" width="4" height="4.6" rx="1.1" fill={W} transform={`rotate(${angle} 12 12)`} />
        ))}
      </g>
      <circle cx="12" cy="12" r="1.6" fill={W} fillOpacity={SOFT} />
    </>
  ),
};

export type MenuIconArtProps = {
  iconKey: ArtKey;
  className?: string;
};

export default function MenuIconArt({ iconKey, className }: MenuIconArtProps) {
  // Mask ids must be unique per instance: the same icon sits in the menu and the dock at once.
  const id = `mi-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-`;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false" data-menu-icon={iconKey}>
      {ART[iconKey](id)}
    </svg>
  );
}

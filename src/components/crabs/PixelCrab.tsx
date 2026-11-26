import React from 'react';

import { cn } from '../../lib/utils';

import { CRAB_TINT_COLOR, type CrabState, type CrabTint } from './crabModel';

// 16×12 sprite: claws, eye stalks, shell; two leg frames swap while it runs,
// and the claws snap open/shut in turn — it scuttles sideways, clacking.
const CLAW_OPEN_L = ['.XX.', 'X..X', 'X.XX', '.XX.'];
const CLAW_SHUT_L = ['....', '.XX.', 'XXXX', '.XX.'];
const CLAW_OPEN_R = CLAW_OPEN_L.map((row) => [...row].reverse().join(''));
const CLAW_SHUT_R = CLAW_SHUT_L.map((row) => [...row].reverse().join(''));

/** Claws in a full-width 16-column grid: left claw at x 0–3, right at x 12–15. */
function claws(left: string[], right: string[]): string[] {
  return left.map((row, y) => `${row}........${right[y]}`);
}

const BODY = [
  '................',
  '................',
  '................',
  '................',
  '..X..X....X..X..',
  '...XXXXXXXXXX...',
  '..XXXXXXXXXXXX..',
  '..XXXXXXXXXXXX..',
  '..XXXXXXXXXXXX..',
  '...XXXXXXXXXX...',
];
const LEGS_A = ['..X.X......X.X..', '.X..X......X..X.'];
const LEGS_B = ['.X.X........X.X.', '.X..X......X..X.'];
const EYES: Array<[number, number]> = [[5, 6], [10, 6]];

function pixels(rows: string[], top = 0): string {
  let path = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === 'X') path += `M${x} ${y + top}h1v1h-1z`;
    }
  });
  return path;
}

const BODY_PATH = pixels(BODY);
const LEGS_A_PATH = pixels(LEGS_A, BODY.length);
const LEGS_B_PATH = pixels(LEGS_B, BODY.length);
const CLAWS_OPEN_PATH = pixels(claws(CLAW_OPEN_L, CLAW_OPEN_R));
// Snap frames: one claw open while the other is shut, then the other way round.
const CLAWS_SNAP_A_PATH = pixels(claws(CLAW_OPEN_L, CLAW_SHUT_R));
const CLAWS_SNAP_B_PATH = pixels(claws(CLAW_SHUT_L, CLAW_OPEN_R));

const BADGE: Record<Exclude<CrabState, 'running'>, string> = {
  done: '✓',
  failed: '✕',
  lost: '…',
};

type PixelCrabProps = {
  tint: CrabTint;
  state: CrabState;
  /** Emoji the crab holds while it works (what it is doing). */
  holding?: string;
  /** Pixel size of one sprite pixel; the crab is 16×12 of them. */
  scale?: number;
  className?: string;
};

/** A pixel crab: scuttles sideways clacking its claws while working, comes back with a tick. */
export default function PixelCrab({ tint, state, holding, scale = 2, className }: PixelCrabProps) {
  const width = 16 * scale;
  const height = 12 * scale;
  const running = state === 'running';
  return (
    <span
      className={cn('crab relative inline-flex flex-shrink-0', `crab--${state}`, className)}
      style={{ width, height, color: CRAB_TINT_COLOR[tint] }}
      aria-hidden
    >
      <svg
        className="crab-sprite"
        width={width}
        height={height}
        viewBox="0 0 16 12"
        shapeRendering="crispEdges"
      >
        <path d={BODY_PATH} fill="currentColor" />
        {running ? (
          <>
            <path className="crab-claws-a" d={CLAWS_SNAP_A_PATH} fill="currentColor" />
            <path className="crab-claws-b" d={CLAWS_SNAP_B_PATH} fill="currentColor" />
          </>
        ) : (
          <path d={CLAWS_OPEN_PATH} fill="currentColor" />
        )}
        <path className={running ? 'crab-legs-a' : undefined} d={LEGS_A_PATH} fill="currentColor" />
        {running && <path className="crab-legs-b" d={LEGS_B_PATH} fill="currentColor" />}
        {EYES.map(([x, y]) => (
          <rect key={x} x={x} y={y} width={1} height={1} fill="rgba(15,15,20,0.85)" />
        ))}
      </svg>
      {running && holding && (
        <span
          className="crab-holding absolute leading-none"
          style={{ fontSize: Math.max(12, 5 * scale), right: -Math.max(6, 2.5 * scale), top: -Math.max(7, 3 * scale) }}
        >
          {holding}
        </span>
      )}
      {!running && (
        <span
          className={cn(
            'absolute -right-1 -top-1 flex items-center justify-center rounded-full font-bold leading-none text-white',
            state === 'done' && 'bg-success',
            state === 'failed' && 'bg-destructive',
            state === 'lost' && 'bg-muted-foreground',
          )}
          style={{ width: Math.max(10, 5 * scale), height: Math.max(10, 5 * scale), fontSize: Math.max(7, 3.5 * scale) }}
        >
          {BADGE[state]}
        </span>
      )}
    </span>
  );
}

/**
 * The start page of the canvas — «Новая вкладка» and the empty canvas: every
 * item of the menu as an iOS home-screen icon. The tile gives way under the
 * finger; the grid reflows with the panel width (3 across when narrow).
 */
import React from 'react';

import { launcherStyleFor } from './newTabModel';
import type { WorkbenchMenuEntry } from './workbenchCanvasModel';

export type WorkbenchLauncherProps = {
  entries: WorkbenchMenuEntry[];
  onPick: (entry: WorkbenchMenuEntry) => void;
  /** A quiet line above the grid. */
  hint?: string;
};

export default function WorkbenchLauncher({ entries, onPick, hint }: WorkbenchLauncherProps) {
  if (entries.length === 0) {
    return <p className="text-center text-sm text-muted-foreground">Нечего открыть</p>;
  }
  return (
    <div className="mx-auto w-full max-w-[34rem]" data-workbench-launcher>
      {hint && <p className="mb-6 text-center text-sm text-muted-foreground">{hint}</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-x-1 gap-y-4">
        {entries.map((entry) => {
          const { Icon, gradient } = launcherStyleFor(entry.kind, entry.ref);
          return (
            <li key={entry.key} className="flex justify-center">
              <button
                type="button"
                aria-label={entry.title}
                title={entry.title}
                onClick={() => onPick(entry)}
                className="group flex w-full max-w-[84px] select-none flex-col items-center gap-1.5 rounded-2xl px-1 pb-1.5 pt-2 outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span
                  aria-hidden
                  className="relative grid h-[60px] w-[60px] place-items-center rounded-[13.5px] shadow-[0_1px_1.5px_rgba(0,0,0,0.12),0_6px_14px_-6px_rgba(0,0,0,0.38)] transition-[transform,filter] duration-150 ease-out group-hover:brightness-[1.06] group-active:scale-[0.92] group-active:brightness-[0.92] motion-reduce:transition-none dark:shadow-[0_1px_1.5px_rgba(0,0,0,0.4),0_6px_14px_-6px_rgba(0,0,0,0.7)]"
                  style={{ background: gradient }}
                >
                  {/* Top light and a hairline edge, so the tile reads on both themes. */}
                  <span className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.32),inset_0_0_0_0.5px_rgba(0,0,0,0.1)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),inset_0_0_0_0.5px_rgba(255,255,255,0.1)]" />
                  <Icon className="relative h-7 w-7 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.2)]" strokeWidth={1.85} />
                </span>
                <span className="line-clamp-2 w-full break-words text-center text-xs leading-tight text-foreground">
                  {entry.title}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

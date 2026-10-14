import React from 'react';

import { stopStateLabel } from './BackgroundTasksStore';
import type { BackgroundTaskStopState } from './BackgroundTasksStore';

type BackgroundTaskStopControlProps = {
  /** The server can stop the task (frame flag); otherwise only the engine itself can. */
  stoppable: boolean;
  /** The engine's name for the caption. */
  engine: string;
  stopState?: BackgroundTaskStopState;
  onStop: () => void;
};

/** The right edge of a «Фон» row: «Стоп», or why there is none. */
export default function BackgroundTaskStopControl({ stoppable, engine, stopState, onStop }: BackgroundTaskStopControlProps) {
  if (!stoppable) {
    return (
      <span className="max-w-36 shrink-0 text-right text-[11px] leading-tight text-muted-foreground">
        {`остановить может только сам ${engine}`}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onStop}
      disabled={stopState === 'stopping' || stopState === 'gone' || stopState === 'turn_ended'}
      className="shrink-0 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
    >
      {stopState === 'stopping' ? stopStateLabel('stopping') : 'Стоп'}
    </button>
  );
}

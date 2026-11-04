import { spawn } from 'node:child_process';

import type { SessionAttentionService } from '@/modules/session-attention/index.js';
import { isModOn } from '@/shared/mods.js';

import { createKeepAwake } from './keep-awake.service.js';

export { createKeepAwake, KEEP_AWAKE_MAX_IDLE_MS, KEEP_AWAKE_RELEASE_MS } from './keep-awake.service.js';
export type { KeepAwakeChild, KeepAwakeOptions, KeepAwakeService, KeepAwakeSpawn } from './keep-awake.service.js';

export type KeepAwakeDependencies = {
  sessionAttention: Pick<SessionAttentionService, 'onChange'>;
};

export type KeepAwakeHandle = {
  stop: () => void;
};

const TICK_MS = 30_000;

/**
 * «Не засыпать, пока идут прогоны» (мод `modKeepAwake`): `server/index.js`
 * calls it after the `sessionAttention.onChange` subscriptions. On macOS a
 * `caffeinate -i -w <pid>` child lives while runs are working.
 */
export function startKeepAwake(deps: KeepAwakeDependencies): KeepAwakeHandle {
  const service = createKeepAwake({
    spawn: (command, args) => spawn(command, args, { stdio: 'ignore' }),
    platform: process.platform,
    now: Date.now,
    isModOn: (userId) => (userId === null ? true : isModOn(userId, 'modKeepAwake')),
  });
  const unsubscribe = deps.sessionAttention.onChange((change) => {
    try {
      service.onChange(change);
    } catch (error) {
      console.error('[KeepAwake] change failed', (error as Error)?.message);
    }
  });
  const timer = setInterval(() => service.tick(), TICK_MS);
  timer.unref?.();
  return {
    stop: () => {
      clearInterval(timer);
      if (typeof unsubscribe === 'function') unsubscribe();
      service.stop();
    },
  };
}

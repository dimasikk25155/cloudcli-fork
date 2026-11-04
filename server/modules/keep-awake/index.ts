import type { SessionAttentionService } from '@/modules/session-attention/index.js';

export type KeepAwakeDependencies = {
  sessionAttention: Pick<SessionAttentionService, 'onChange'>;
};

export type KeepAwakeHandle = {
  stop: () => void;
};

/**
 * «Не засыпать, пока идут прогоны» (мод `modKeepAwake`).
 * Заготовка сборки «Рабочий стол»: `server/index.js` вызывает её после
 * подписок `sessionAttention.onChange`; пока ничего не делает — поведение
 * (`caffeinate -i` на macOS) добавляет свой таск без правки `server/index.js`.
 */
export function startKeepAwake(_deps: KeepAwakeDependencies): KeepAwakeHandle {
  return { stop: () => {} };
}

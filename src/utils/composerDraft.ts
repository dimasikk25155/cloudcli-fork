// Готовое задание в поле ввода — или сразу в отправку.
//
// Панели «починить сервис» кладут текст и ждут Enter: человек видит формулировку.
// Кнопки готовых работ так делать нельзя: служебный бриф не для глаз клиента.
// Они шлют короткий ярлык на экран и бриф агенту, сразу.

export const COMPOSER_DRAFT_EVENT = 'neo3:composer-draft';

export type ComposerWorkMode = 'autopilot' | 'checkpoints' | 'interrogate' | 'build';

export type ComposerDraftDetail = {
  text: string;
  workMode?: ComposerWorkMode;
  /** Agent-only instructions. Never shown in the input or the bubble. */
  hiddenBrief?: string;
  /** Submit as soon as the composer has the text (job buttons). */
  autoSend?: boolean;
};

export function sendToComposer(
  text: string,
  extras?: Omit<ComposerDraftDetail, 'text'>,
): void {
  if (!text && !extras?.hiddenBrief) return;
  window.dispatchEvent(
    new CustomEvent<ComposerDraftDetail>(COMPOSER_DRAFT_EVENT, {
      detail: { text, ...extras },
    }),
  );
}

// Готовое задание, положенное в поле ввода чата.
//
// Панели (сервер, файлы) умеют объяснить проблему словами, но починить её может
// только агент — а Дима не должен переписывать её в чат руками с телефона.
// Поэтому панель кладёт готовый текст в composer и уходит с дороги: отправляет
// человек, ничего не запускается само.

export const COMPOSER_DRAFT_EVENT = 'neo3:composer-draft';

export type ComposerDraftDetail = { text: string };

/** Положить текст в поле ввода активного чата (не отправляя его). */
export function sendToComposer(text: string): void {
  if (!text) return;
  window.dispatchEvent(new CustomEvent<ComposerDraftDetail>(COMPOSER_DRAFT_EVENT, { detail: { text } }));
}

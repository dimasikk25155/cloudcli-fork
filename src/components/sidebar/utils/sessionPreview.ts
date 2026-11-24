/**
 * «Первые 5 + Показать ещё» в списке чатов проекта (просьба Димы 24.11,
 * заменила «прятать чаты старше 5 дней» от 14.11): свежих много не видно,
 * а до старых можно добраться кнопкой.
 */

/** Сколько верхних чатов проекта видно сразу. */
export const SESSION_PREVIEW_SIZE = 5;
/** Сколько чатов добавляет одно нажатие «Показать ещё». */
export const SESSION_PREVIEW_STEP = 10;

type PreviewRow = { session: { id: string | number }; depth: number };

/**
 * Оставляет первые `limit` верхних карточек (с их вложенными чатами) и
 * всегда — чаты из `keepIds` (работающие, открытый сейчас, закреплённые),
 * где бы они ни стояли. Порядок строк не меняется.
 */
export const previewSessionRows = <R extends PreviewRow>(
  rows: readonly R[],
  limit: number,
  keepIds: ReadonlySet<string>,
): { rows: R[]; hiddenCount: number } => {
  const visible: R[] = [];
  let topIndex = -1;
  let parentVisible = false;
  for (const row of rows) {
    const kept = keepIds.has(String(row.session.id));
    if (row.depth === 0) {
      topIndex += 1;
      parentVisible = topIndex < limit || kept;
      if (parentVisible) visible.push(row);
    } else if (parentVisible || kept) {
      visible.push(row);
    }
  }
  return { rows: visible, hiddenCount: rows.length - visible.length };
};

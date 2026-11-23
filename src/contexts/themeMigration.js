// Подмена убранных тем и варианты «Неона».
//
// Чистый модуль: ни DOM, ни React, ни сети — его читают ThemeContext,
// фон темы и тесты. Копии таблиц живут ещё в одном месте: inline-скрипт
// index.html ставит тему до загрузки бандла и импортировать модуль не может.
// Совпадение копий сторожит themeMigration.test.ts.

/** Тема, в которую попадает всё неизвестное. Равна DEFAULT_THEME реестра. */
const FALLBACK_THEME = 'ember';

/** Живые темы. Копия THEMES из ThemeContext.jsx (тест сверяет). */
const CURRENT_THEMES = ['ember', 'codex', 'bio', 'neon', 'glass', 'claudeLight'];

/**
 * Варианты «Неона»: цвет акцента + фото. Восемь прежних фото-тем отличались
 * друг от друга только этим, поэтому стали вариантами одной темы.
 * `file` — прежнее фото из public/theme-bg (файлы не переименовываются).
 * У «Лаймовой» было пять фото — вариант берёт основное.
 */
export const NEON_VARIANTS = Object.freeze([
  Object.freeze({ id: 'city', label: 'Голубой', legacyTheme: 'neonCity', file: 'neonCity.jpg' }),
  Object.freeze({ id: 'synthwave', label: 'Розовый', legacyTheme: 'synthwaveDrive', file: 'synthwaveDrive.jpg' }),
  Object.freeze({ id: 'nebula', label: 'Мятный', legacyTheme: 'nebulaFlow', file: 'nebulaFlow.jpg' }),
  Object.freeze({ id: 'mission', label: 'Синий', legacyTheme: 'missionControl', file: 'missionControl.jpg' }),
  Object.freeze({ id: 'bento', label: 'Зелёный', legacyTheme: 'bento3d', file: 'bento3d.jpg' }),
  Object.freeze({ id: 'chrome', label: 'Сиреневый', legacyTheme: 'liquidChrome', file: 'liquidChrome.jpg' }),
  Object.freeze({ id: 'zen', label: 'Янтарный', legacyTheme: 'zenParticles', file: 'zenParticles.jpg' }),
  Object.freeze({ id: 'kinetic', label: 'Лаймовый', legacyTheme: 'kineticType', file: 'kineticType.jpg' }),
]);

export const DEFAULT_NEON_VARIANT = 'city';

/** Убранный id → куда он ведёт. `claudeLight` здесь не бывает никогда. */
export const LEGACY_THEME_MAP = Object.freeze({
  ...Object.fromEntries(
    NEON_VARIANTS.map((variant) => [variant.legacyTheme, { theme: 'neon', neonVariant: variant.id }])
  ),
  gt: { theme: 'ember' },
  claude: { theme: 'ember' },
  editorial: { theme: 'glass' },
});

/** Существует ли такой вариант «Неона». */
export const isNeonVariant = (id) =>
  typeof id === 'string' && NEON_VARIANTS.some((variant) => variant.id === id);

/** Вариант или вариант по умолчанию, если id чужой. */
export const resolveNeonVariant = (id) => (isNeonVariant(id) ? id : DEFAULT_NEON_VARIANT);

/** Путь к фото варианта; чужой id — фото варианта по умолчанию. */
export const neonVariantFile = (id) => {
  const active = resolveNeonVariant(id);
  const variant = NEON_VARIANTS.find((entry) => entry.id === active);
  return `/theme-bg/${variant.file}`;
};

/**
 * Приводит сохранённый id темы к живому.
 *
 * - живая тема → она же, `migrated: false`;
 * - убранная → ближайшая по LEGACY_THEME_MAP (+ вариант «Неона» для фото-тем);
 * - всё остальное (мусор, пусто, тема из будущей версии) → оранжевая.
 *
 * `neonVariant` заполнен только когда его диктует убранная тема: у живого
 * «Неона» вариант хранится отдельно (`localStorage.neonVariant`).
 */
export const migrateThemeId = (id) => {
  if (typeof id === 'string' && CURRENT_THEMES.includes(id)) {
    return { theme: id, neonVariant: null, migrated: false };
  }
  const legacy = typeof id === 'string' && Object.hasOwn(LEGACY_THEME_MAP, id)
    ? LEGACY_THEME_MAP[id]
    : null;
  if (legacy) {
    return { theme: legacy.theme, neonVariant: legacy.neonVariant ?? null, migrated: true };
  }
  return { theme: FALLBACK_THEME, neonVariant: null, migrated: true };
};

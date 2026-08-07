import { backgroundFile } from '../../contexts/ThemeContext';

import ShaderBackground from './ShaderBackground';

/**
 * Per-theme full-viewport background, rendered behind the whole app at z-0.
 *
 * Each theme owns its own backdrop so themes look genuinely different, not
 * just recoloured. Cinematic themes use a real generated 4K photograph
 * (public/theme-bg/<key>.jpg) with a subtle Ken Burns drift and a dark scrim
 * for text legibility, rather than hand-drawn CSS shapes — attempts at
 * replicating scenes like a command bridge or a nebula in pure CSS read as
 * cheap; a real photographic still does not.
 */
const PHOTO_THEMES = new Set([
  'neonCity',
  'synthwaveDrive',
  'nebulaFlow',
  'missionControl',
  'bento3d',
  'kineticType',
  'liquidChrome',
  'zenParticles',
]);

/**
 * `enabled` = тумблер "Фон" в настройках. Выключенный гасит фон ЦЕЛИКОМ —
 * остаются только цвета темы на плоской заливке. Раньше этот тумблер назывался
 * "Движение фона" и гасил лишь анимацию, но движение к тому моменту осталось
 * только у двух тем из тринадцати, так что тумблер выглядел неработающим.
 * По явному запросу: нужна возможность убрать картинку, а не притормозить её.
 */
/**
 * Темы, у которых фон — плоская заливка `--background` и ничего больше.
 * Разбор референсов дал прямое требование «ноль декоративных градиентов»:
 * такая тема разделяет поверхности линией и ступенью тона, а картинка или
 * шейдер за ними эту работу ломают. Без этого списка любая новая тема
 * молча проваливалась бы в WebGL-фон из ветки по умолчанию.
 */
const FLAT_THEMES = new Set(['ember', 'gt', 'editorial', 'glass']);

export default function ThemeBackground({
  theme = 'default',
  enabled = true,
  variant,
  customUrl,
}: {
  theme?: string;
  enabled?: boolean;
  variant?: string;
  customUrl?: string | null;
}) {
  if (!enabled) {
    return null;
  }

  // Своя картинка бьёт штатный фон темы в любой теме, а не только в
  // стеклянной: пользователь, загрузивший фон, ожидает увидеть именно его.
  // Скрим поверх обязателен — без него текст интерфейса тонет в чужом снимке.
  if (customUrl) {
    return (
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="theme-photo-bg theme-photo-bg--static"
          style={{ backgroundImage: `url(${customUrl})` }}
        />
        <div className="theme-photo-scrim" />
      </div>
    );
  }

  if (FLAT_THEMES.has(theme)) {
    return null;
  }

  // Анимацию оставляем включённой всегда: отдельного тумблера на неё больше
  // нет, а темы, где движение есть, без него выглядят наполовину собранными.
  const animated = true;

  if (PHOTO_THEMES.has(theme)) {
    return (
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className={animated ? 'theme-photo-bg' : 'theme-photo-bg theme-photo-bg--static'}
          style={{ backgroundImage: `url(${backgroundFile(theme, variant)})` }}
        />
        <div className="theme-photo-scrim" />
      </div>
    );
  }

  // Default theme: original animated WebGL background.
  return <ShaderBackground variant="default" frozen={!animated} />;
}

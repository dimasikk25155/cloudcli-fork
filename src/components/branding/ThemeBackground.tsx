import {
  backgroundsForTheme,
  isVideoTheme,
  useTheme,
  videoFile,
  videoPosterFile,
  videoTallFile,
  videoTallPosterFile,
} from '../../contexts/ThemeContext';
import { neonVariantFile } from '../../contexts/themeMigration';

import ThemeVideoBackground from './ThemeVideoBackground';

/**
 * Per-theme full-viewport background, rendered behind the whole app at z-0.
 *
 * Each theme owns its own backdrop so themes look genuinely different, not
 * just recoloured:
 *   - «Оранжевая» (ember) — живые обои, зацикленный ролик;
 *   - «Неон» (neon) — фотография варианта (цвет акцента и фото выбираются
 *     вместе, см. NEON_VARIANTS) с медленным дрейфом и затемнением под текст;
 *   - остальные — плоские: их фон красит материал темы (`--shell-*`).
 */
const PHOTO_THEMES = new Set(['neon']);

/**
 * Темы, у которых фон — материал самой темы (`--shell-*`) и ничего больше:
 * ровный графит, чистый чёрный «Био», пастельный градиент «Бирюзовой», бумага
 * «Светлой Claude». Картинка за ними эту работу ломает.
 */
const FLAT_THEMES = new Set(['codex', 'glass', 'claudeLight', 'bio']);

/**
 * `enabled` = тумблер «Фон» в настройках. Выключенный гасит фон ЦЕЛИКОМ —
 * остаётся материал темы. По явному запросу: нужна возможность убрать
 * картинку, а не притормозить её.
 *
 * Живые обои «Оранжевой»: ролик не спорит с интерфейсом за внимание, потому
 * что уходит под затемнение. Цена движения оплачена в самом ролике и в
 * компоненте: родные 24 кадра, без замедления, пауза при уходе окна в фон —
 * см. `ThemeVideoBackground`.
 */
export default function ThemeBackground({
  theme = 'default',
  enabled = true,
  variant,
  customUrl,
  onVideoEnded,
}: {
  theme?: string;
  enabled?: boolean;
  variant?: string;
  customUrl?: string | null;
  onVideoEnded?: () => void;
}) {
  // Вариант «Неона» — свой на устройстве; фото едет за ним без перезагрузки.
  const { neonVariant } = useTheme() as { neonVariant: string };

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

  if (isVideoTheme(theme)) {
    const playlist = Boolean(onVideoEnded) && backgroundsForTheme(theme).length > 1;
    return (
      <ThemeVideoBackground
        src={videoFile(theme, variant)}
        poster={videoPosterFile(theme, variant)}
        tallSrc={videoTallFile(theme, variant)}
        tallPoster={videoTallPosterFile(theme, variant)}
        onEnded={playlist ? onVideoEnded : undefined}
      />
    );
  }

  if (FLAT_THEMES.has(theme)) {
    return null;
  }

  if (PHOTO_THEMES.has(theme)) {
    return (
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="theme-photo-bg"
          style={{ backgroundImage: `url(${neonVariantFile(neonVariant)})` }}
        />
        <div className="theme-photo-scrim" />
      </div>
    );
  }

  // Неизвестная тема (до ThemeBackground не доходит: id подменяет
  // migrateThemeId) — без слоя, фон даёт материал темы.
  return null;
}

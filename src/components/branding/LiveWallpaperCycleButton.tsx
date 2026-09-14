import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme, isVideoTheme } from '../../contexts/ThemeContext';

/**
 * Стрелка «следующий фон» в углу главного экрана.
 * Только в режиме «Автосмена» и только если штатный ролик не перекрыт
 * своей картинкой — иначе кнопка переключала бы то, чего не видно.
 */
export default function LiveWallpaperCycleButton() {
  const { t } = useTranslation('settings');
  const { theme, customBackground, cycleLiveWallpaper, liveWallpaperAuto } = useTheme();

  if (!isVideoTheme(theme) || customBackground || !liveWallpaperAuto) return null;

  return (
    <button
      type="button"
      onClick={cycleLiveWallpaper}
      aria-label={t('appearanceSettings.liveWallpaper.next', { defaultValue: 'Next background' })}
      title={t('appearanceSettings.liveWallpaper.next', { defaultValue: 'Next background' })}
      className="pointer-events-auto absolute bottom-24 left-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/70 text-foreground shadow-sm transition-colors duration-150 hover:bg-background"
    >
      <ChevronRight className="h-5 w-5" strokeWidth={2.2} />
    </button>
  );
}

import { ArrowRightLeft, Image as ImageIcon, Palette, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  useTheme,
  THEMES,
  THEME_LABELS,
  backgroundsForTheme,
  isVideoTheme,
  LIVE_WALLPAPER_OFF,
  LIVE_WALLPAPER_AUTO,
  liveWallpaperSelectValue,
} from '../../../contexts/ThemeContext';
import LanguageSelector from '../../../shared/view/ui/LanguageSelector';
import {
  INPUT_SETTING_TOGGLES,
  SETTING_ROW_CLASS,
  TOOL_DISPLAY_TOGGLES,
} from '../constants';
import type {
  PreferenceToggleItem,
  PreferenceToggleKey,
  QuickSettingsPreferences,
} from '../types';

import type { AutoRelayControl } from '../../relay/useAutoRelay';

import QuickSettingsSection from './QuickSettingsSection';
import QuickSettingsToggleRow from './QuickSettingsToggleRow';

type QuickSettingsContentProps = {
  isDarkMode: boolean;
  isMobile?: boolean;
  preferences: QuickSettingsPreferences;
  onPreferenceChange: (key: PreferenceToggleKey, value: boolean) => void;
  /** «Авто-перенос» of the open chat; null when no chat is open. */
  autoRelay?: AutoRelayControl | null;
  autoRelayNewChats?: boolean;
  onAutoRelayNewChatsChange?: (value: boolean) => void;
  /** «Перенести» in «Встроенные моды»; false → no «Авто-перенос» section. */
  showAutoRelay?: boolean;
};

export default function QuickSettingsContent({
  isDarkMode,
  isMobile = false,
  preferences,
  onPreferenceChange,
  autoRelay = null,
  autoRelayNewChats = false,
  onAutoRelayNewChatsChange,
  showAutoRelay = true,
}: QuickSettingsContentProps) {
  const { t } = useTranslation('settings');
  const {
    shaderEnabled,
    setShaderEnabled,
    theme,
    setTheme,
    backgroundVariant,
    setThemeBackground,
    setLiveWallpaper,
  } = useTheme();
  // Селектор картинки показываем только там, где есть из чего выбирать.
  const backgroundVariants = shaderEnabled ? backgroundsForTheme(theme) : [];
  const liveWallpaperTheme = isVideoTheme(theme);
  const liveWallpaperValue = liveWallpaperSelectValue(shaderEnabled, backgroundVariant, theme);
  const inputSettingToggles = INPUT_SETTING_TOGGLES
    .filter(({ key }) => preferences.voiceEnabled || key !== 'voiceEnabled')
    // Двойной Enter имеет смысл только там, где есть настоящая клавиатура.
    .filter(({ desktopOnly }) => !desktopOnly || !isMobile);

  const renderToggleRows = (items: PreferenceToggleItem[]) => (
    items.map(({ key, labelKey, icon }) => (
      <QuickSettingsToggleRow
        key={key}
        label={t(labelKey)}
        icon={icon}
        checked={preferences[key]}
        onCheckedChange={(value) => onPreferenceChange(key, value)}
      />
    ))
  );

  return (
    <div className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden bg-background p-4">
      <QuickSettingsSection title={t('quickSettings.sections.appearance')}>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            <Palette className="h-4 w-4 text-muted-foreground" />
            {t('quickSettings.theme')}
          </span>
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {THEMES.map((themeKey) => (
              <option key={themeKey} value={themeKey}>
                {(THEME_LABELS as Record<string, string>)[themeKey] || themeKey}
              </option>
            ))}
          </select>
        </div>
        {liveWallpaperTheme ? (
          <div className={SETTING_ROW_CLASS}>
            <span className="flex items-center gap-2 text-sm text-foreground">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              {t('appearanceSettings.liveWallpaper.label', { defaultValue: 'Background' })}
            </span>
            <select
              value={liveWallpaperValue}
              onChange={(event) => setLiveWallpaper(event.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value={LIVE_WALLPAPER_OFF}>
                {t('appearanceSettings.liveWallpaper.off', { defaultValue: 'Off' })}
              </option>
              <option value={LIVE_WALLPAPER_AUTO}>
                {t('appearanceSettings.liveWallpaper.auto', { defaultValue: 'Auto rotate' })}
              </option>
              {backgroundsForTheme(theme).map((variant: { id: string; label: string }) => (
                <option key={variant.id} value={variant.id}>
                  {variant.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            {backgroundVariants.length > 1 && (
              <div className={SETTING_ROW_CLASS}>
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  {t('quickSettings.themeBackground')}
                </span>
                <select
                  value={backgroundVariant}
                  onChange={(event) => setThemeBackground(theme, event.target.value)}
                  className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {backgroundVariants.map((variant: { id: string; label: string }) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <QuickSettingsToggleRow
              label={t('quickSettings.showBackground')}
              icon={ImageIcon}
              checked={shaderEnabled}
              onCheckedChange={setShaderEnabled}
            />
          </>
        )}
        <LanguageSelector compact />
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.toolDisplay')}>
        {renderToggleRows(TOOL_DISPLAY_TOGGLES)}
      </QuickSettingsSection>

      {showAutoRelay && (
        <QuickSettingsSection title="Авто-перенос">
          {autoRelay && (
            <QuickSettingsToggleRow
              label="Этот чат"
              icon={ArrowRightLeft}
              checked={Boolean(autoRelay.status?.enabled)}
              onCheckedChange={autoRelay.setEnabled}
            />
          )}
          {onAutoRelayNewChatsChange && (
            <QuickSettingsToggleRow
              label="Включать в новых чатах"
              icon={Sparkles}
              checked={autoRelayNewChats}
              onCheckedChange={onAutoRelayNewChatsChange}
            />
          )}
          <p className="ml-3 text-xs text-muted-foreground">
            Чат разросся — агент сам соберёт записку и продолжит в новом чате
          </p>
        </QuickSettingsSection>
      )}

      <QuickSettingsSection title={t('quickSettings.sections.inputSettings')}>
        {renderToggleRows(inputSettingToggles)}
        <p className="ml-3 text-xs text-muted-foreground">
          {t('quickSettings.sendByCtrlEnterDescription')}
        </p>
        {!isMobile && (
          <p className="ml-3 text-xs text-muted-foreground">
            {t('quickSettings.sendByDoubleEnterDescription')}
          </p>
        )}
      </QuickSettingsSection>
    </div>
  );
}

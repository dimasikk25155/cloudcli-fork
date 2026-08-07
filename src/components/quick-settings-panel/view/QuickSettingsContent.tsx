import { Image as ImageIcon, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  useTheme,
  THEMES,
  THEME_LABELS,
  backgroundsForTheme,
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

import QuickSettingsSection from './QuickSettingsSection';
import QuickSettingsToggleRow from './QuickSettingsToggleRow';

type QuickSettingsContentProps = {
  isDarkMode: boolean;
  preferences: QuickSettingsPreferences;
  onPreferenceChange: (key: PreferenceToggleKey, value: boolean) => void;
};

export default function QuickSettingsContent({
  isDarkMode,
  preferences,
  onPreferenceChange,
}: QuickSettingsContentProps) {
  const { t } = useTranslation('settings');
  const {
    shaderEnabled,
    setShaderEnabled,
    theme,
    setTheme,
    backgroundVariant,
    setThemeBackground,
  } = useTheme();
  // Селектор картинки показываем только там, где есть из чего выбирать.
  const backgroundVariants = shaderEnabled ? backgroundsForTheme(theme) : [];
  const inputSettingToggles = preferences.voiceEnabled
    ? INPUT_SETTING_TOGGLES
    : INPUT_SETTING_TOGGLES.filter(({ key }) => key !== 'voiceEnabled');

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
        <LanguageSelector compact />
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.toolDisplay')}>
        {renderToggleRows(TOOL_DISPLAY_TOGGLES)}
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.inputSettings')}>
        {renderToggleRows(inputSettingToggles)}
        <p className="ml-3 text-xs text-muted-foreground">
          {t('quickSettings.sendByCtrlEnterDescription')}
        </p>
      </QuickSettingsSection>
    </div>
  );
}

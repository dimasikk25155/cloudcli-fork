import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeEditorSettingsState, ProjectSortOrder } from '../../types/types';
import LanguageSelector from '../../../../shared/view/ui/LanguageSelector';
import {
  useTheme,
  THEMES,
  THEME_LABELS,
  UI_SCALES,
  backgroundsForTheme,
} from '../../../../contexts/ThemeContext';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

import ThemeTweakPanel from './ThemeTweakPanel';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
};

export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  const {
    shaderEnabled,
    setShaderEnabled,
    theme,
    setTheme,
    uiScale,
    setUiScale,
    backgroundVariant,
    setThemeBackground,
    customBackground,
    uploadCustomBackground,
    clearCustomBackground,
  } = useTheme();
  const backgroundVariants = shaderEnabled ? backgroundsForTheme(theme) : [];
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);

  const handleBackgroundFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setBackgroundBusy(true);
    setBackgroundError(null);
    try {
      await uploadCustomBackground(file);
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : 'Не удалось загрузить фон');
    } finally {
      setBackgroundBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection title={t('appearanceSettings.theme.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.theme.label')}
            description={t('appearanceSettings.theme.description')}
          >
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-44"
            >
              {THEMES.map((themeKey) => (
                <option key={themeKey} value={themeKey}>
                  {(THEME_LABELS as Record<string, string>)[themeKey] || themeKey}
                </option>
              ))}
            </select>
          </SettingsRow>

          {backgroundVariants.length > 1 && (
            <SettingsRow
              label={t('appearanceSettings.themeBackground.label')}
              description={t('appearanceSettings.themeBackground.description')}
            >
              <select
                value={backgroundVariant}
                onChange={(event) => setThemeBackground(theme, event.target.value)}
                className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-44"
              >
                {backgroundVariants.map((variant: { id: string; label: string }) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label}
                  </option>
                ))}
              </select>
            </SettingsRow>
          )}

          <SettingsRow
            label={t('appearanceSettings.showBackground.enable.label')}
            description={t('appearanceSettings.showBackground.enable.description')}
          >
            <SettingsToggle
              checked={shaderEnabled}
              onChange={setShaderEnabled}
              ariaLabel={t('appearanceSettings.showBackground.enable.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.customBackground.label', { defaultValue: 'Your own background' })}
            description={t('appearanceSettings.customBackground.description', {
              defaultValue: 'A picture from your device, shared across all your devices. Replaces the theme backdrop.',
            })}
          >
            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
              <input
                ref={backgroundInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  void handleBackgroundFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={backgroundBusy}
                  onClick={() => backgroundInputRef.current?.click()}
                  className="rounded-ui-lg border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors duration-fast ease-ui hover:bg-muted disabled:opacity-50"
                >
                  {backgroundBusy
                    ? t('appearanceSettings.customBackground.uploading', { defaultValue: 'Uploading…' })
                    : t('appearanceSettings.customBackground.choose', { defaultValue: 'Choose picture' })}
                </button>
                {customBackground && (
                  <button
                    type="button"
                    disabled={backgroundBusy}
                    onClick={() => void clearCustomBackground()}
                    className="rounded-ui-lg border border-input px-3 py-2 text-sm text-muted-foreground transition-colors duration-fast ease-ui hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {t('appearanceSettings.customBackground.reset', { defaultValue: 'Restore default' })}
                  </button>
                )}
              </div>
              {backgroundError && (
                <span className="text-xs text-destructive sm:text-right">{backgroundError}</span>
              )}
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <ThemeTweakPanel />

      <SettingsSection title={t('appearanceSettings.uiScale.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.uiScale.label')}
            description={t('appearanceSettings.uiScale.description')}
          >
            <select
              value={uiScale}
              onChange={(event) => setUiScale(Number(event.target.value))}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-28"
            >
              {UI_SCALES.map((scale) => (
                <option key={scale} value={scale}>
                  {scale}%
                </option>
              ))}
            </select>
          </SettingsRow>

          <LanguageSelector />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.projectSorting.label')}
            description={t('appearanceSettings.projectSorting.description')}
          >
            <select
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.codeEditor.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.codeEditor.wordWrap.label')}
            description={t('appearanceSettings.codeEditor.wordWrap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.wordWrap}
              onChange={onCodeEditorWordWrapChange}
              ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.showMinimap.label')}
            description={t('appearanceSettings.codeEditor.showMinimap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.showMinimap}
              onChange={onCodeEditorShowMinimapChange}
              ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.lineNumbers.label')}
            description={t('appearanceSettings.codeEditor.lineNumbers.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.lineNumbers}
              onChange={onCodeEditorLineNumbersChange}
              ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.fontSize.label')}
            description={t('appearanceSettings.codeEditor.fontSize.description')}
          >
            <select
              value={codeEditorSettings.fontSize}
              onChange={(event) => onCodeEditorFontSizeChange(event.target.value)}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-28"
            >
              <option value="10">10px</option>
              <option value="11">11px</option>
              <option value="12">12px</option>
              <option value="13">13px</option>
              <option value="14">14px</option>
              <option value="15">15px</option>
              <option value="16">16px</option>
              <option value="18">18px</option>
              <option value="20">20px</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

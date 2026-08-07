import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Copy, RotateCcw } from 'lucide-react';

import { useTheme, THEME_LABELS } from '../../../../contexts/ThemeContext';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import {
  FONT_SLOTS,
  FONT_STACKS,
  SLIDERS,
  tweaksToCss,
  type ThemeTweaks,
} from '../../../../utils/themeTweaks';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

const selectClass =
  'w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-44';

type SliderKey = (typeof SLIDERS)[number]['key'];

/** Какая ручка в какой группе. Порядок групп — от самого заметного к тонкому. */
const MATERIAL_KEYS: SliderKey[] = ['blur', 'panelAlpha', 'grain'];
const RHYTHM_KEYS: SliderKey[] = ['radius', 'density', 'duration', 'tracking'];

/** Дробные ручки читаются только с нужным числом знаков: 0.7200000001 — мусор. */
const formatValue = (value: number, step: number, unit: string) => {
  const digits = step < 0.01 ? 3 : step < 1 ? 2 : 0;
  return `${value.toFixed(digits)}${unit}`;
};

/**
 * Подстройка активной темы вживую. Свёрнута по умолчанию: обычному
 * пользователю она не нужна, а при сборке темы без неё каждый пиксель
 * стоит отдельной перегенерации кода.
 */
export default function ThemeTweakPanel() {
  const { t } = useTranslation('settings');
  const { theme, activeTweaks, setThemeTweaks } = useTheme();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const tweaks: ThemeTweaks = activeTweaks;

  const update = (patch: ThemeTweaks) => {
    const next = { ...tweaks, ...patch };
    // undefined в патче означает «вернуть как в теме» — ключ надо убрать, иначе
    // он уедет на сервер и вернётся оттуда пустым значением.
    Object.keys(patch).forEach((key) => {
      if (patch[key as keyof ThemeTweaks] === undefined) {
        delete next[key as keyof ThemeTweaks];
      }
    });
    setThemeTweaks(theme, next);
  };

  const reset = () => setThemeTweaks(theme, {});

  const copyCss = async () => {
    const ok = await copyTextToClipboard(tweaksToCss(theme, tweaks));
    setCopied(ok);
    setTimeout(() => setCopied(false), 1500);
  };

  const themeLabel = (THEME_LABELS as Record<string, string>)[theme] || theme;
  const touched = Object.keys(tweaks).length > 0;

  const groupTitle = (label: string) => (
    <div className="px-4 pt-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
      {label}
    </div>
  );

  const fontRow = (slot: (typeof FONT_SLOTS)[number]) => (
    <SettingsRow key={slot.key} label={t(`appearanceSettings.tweaks.${slot.key}`)}>
      <select
        value={tweaks[slot.key] || ''}
        onChange={(event) => update({ [slot.key]: event.target.value || undefined })}
        className={selectClass}
      >
        <option value="">{t('appearanceSettings.tweaks.fromTheme')}</option>
        {FONT_STACKS.map((stack) => (
          <option key={stack.id} value={stack.id}>{stack.label}</option>
        ))}
      </select>
    </SettingsRow>
  );

  const sliderRow = (key: SliderKey) => {
    const slider = SLIDERS.find((item) => item.key === key);
    if (!slider) return null;
    const value = tweaks[key];
    return (
      <SettingsRow key={key} label={t(`appearanceSettings.tweaks.${key}`)}>
        <div className="flex w-full items-center gap-3 sm:w-44">
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={slider.step}
            value={value ?? slider.min}
            onChange={(event) => update({ [key]: Number(event.target.value) })}
            className="h-1 w-full flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
          />
          <span className="w-16 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {value === undefined ? '—' : formatValue(value, slider.step, slider.unit)}
          </span>
        </div>
      </SettingsRow>
    );
  };

  return (
    <SettingsSection title={t('appearanceSettings.tweaks.title')}>
      <SettingsCard divided>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">
              {t('appearanceSettings.tweaks.label', { theme: themeLabel })}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {t('appearanceSettings.tweaks.description')}
            </div>
          </div>
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-base ease-ui ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <>
            {groupTitle(t('appearanceSettings.tweaks.groupFonts'))}
            {FONT_SLOTS.map(fontRow)}

            {groupTitle(t('appearanceSettings.tweaks.groupMaterial'))}
            {MATERIAL_KEYS.map(sliderRow)}
            <SettingsRow
              label={t('appearanceSettings.tweaks.shadows')}
              description={t('appearanceSettings.tweaks.shadowsHint')}
            >
              <SettingsToggle
                checked={tweaks.shadows !== false}
                onChange={(checked) => update({ shadows: checked ? undefined : false })}
                ariaLabel={t('appearanceSettings.tweaks.shadows')}
              />
            </SettingsRow>

            {groupTitle(t('appearanceSettings.tweaks.groupRhythm'))}
            {RHYTHM_KEYS.map(sliderRow)}

            <div className="flex flex-wrap gap-2 px-4 py-4">
              <button
                type="button"
                onClick={copyCss}
                disabled={!touched}
                className="inline-flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors duration-fast ease-ui hover:bg-secondary disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? t('appearanceSettings.tweaks.copied') : t('appearanceSettings.tweaks.copyCss')}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={!touched}
                className="inline-flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-muted-foreground transition-colors duration-fast ease-ui hover:bg-secondary disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('appearanceSettings.tweaks.reset')}
              </button>
            </div>
          </>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

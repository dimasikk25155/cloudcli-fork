import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Copy, RotateCcw } from 'lucide-react';

import { useTheme, THEME_LABELS } from '../../../../contexts/ThemeContext';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import {
  FONT_SLOTS,
  FONT_STACKS,
  SLIDERS,
  readThemeDefaults,
  tweaksToCss,
  type ThemeDefaults,
  type ThemeTweaks,
} from '../../../../utils/themeTweaks';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

import ThemeTweakPreview from './ThemeTweakPreview';

const selectClass =
  'w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-44';

type SliderKey = (typeof SLIDERS)[number]['key'];

/** Какая ручка в какой группе. Порядок групп — от самого заметного к тонкому. */
const MATERIAL_KEYS: SliderKey[] = ['blur', 'panelAlpha', 'grain'];
const RHYTHM_KEYS: SliderKey[] = ['radius', 'density', 'duration', 'tracking'];

/**
 * Готовые наборы: одна кнопка двигает несколько ручек сразу.
 *
 * Ручку по одной крутит тот, кто уже знает, что такое `--panel-alpha`.
 * Остальным нужен вход по результату — «хочу больше стекла», — и уже потом
 * доводка. Значения намеренно выражают характер, а не среднее по теме.
 */
const PRESETS: Array<{ id: string; patch: ThemeTweaks }> = [
  { id: 'glassy', patch: { blur: 34, panelAlpha: 0.42, grain: 0.03 } },
  { id: 'dense', patch: { density: 0.85, radius: 6, tracking: 0 } },
  { id: 'soft', patch: { radius: 18, duration: 320, density: 1.1 } },
  { id: 'flat', patch: { blur: 0, grain: 0, duration: 120, shadows: false } },
];

/** Дробные ручки читаются только с нужным числом знаков: 0.7200000001 — мусор. */
const formatValue = (value: number, step: number, unit: string) => {
  const digits = step < 0.01 ? 3 : step < 1 ? 2 : 0;
  return `${value.toFixed(digits)}${unit}`;
};

/** Значение обязано лечь на сетку шага, иначе ползунок дрожит между делениями. */
const snap = (value: number, min: number, max: number, step: number) => {
  const snapped = Math.round((value - min) / step) * step + min;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
};

/** Три ступени характера: по ним пишется слово рядом с числом. */
const levelOf = (value: number, min: number, max: number): 'low' | 'mid' | 'high' => {
  const ratio = (value - min) / (max - min || 1);
  if (ratio < 0.34) return 'low';
  if (ratio < 0.67) return 'mid';
  return 'high';
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

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
  const [defaults, setDefaults] = useState<ThemeDefaults | null>(null);
  const tweenFrame = useRef<number | null>(null);

  const tweaks: ThemeTweaks = activeTweaks;

  // Значения самой темы читаются при раскрытии и при смене темы: чтение
  // временно снимает инлайновые твики, поэтому делать это на каждый кадр
  // ползунка нельзя — картинка бы мигала.
  useEffect(() => {
    if (!open) return;
    setDefaults(readThemeDefaults());
  }, [open, theme]);

  useEffect(() => () => {
    if (tweenFrame.current) cancelAnimationFrame(tweenFrame.current);
  }, []);

  const update = useCallback(
    (patch: ThemeTweaks) => {
      const next = { ...tweaks, ...patch };
      // undefined в патче означает «вернуть как в теме» — ключ надо убрать, иначе
      // он уедет на сервер и вернётся оттуда пустым значением.
      Object.keys(patch).forEach((key) => {
        if (patch[key as keyof ThemeTweaks] === undefined) {
          delete next[key as keyof ThemeTweaks];
        }
      });
      setThemeTweaks(theme, next);
    },
    [setThemeTweaks, theme, tweaks],
  );

  const reset = () => {
    if (tweenFrame.current) cancelAnimationFrame(tweenFrame.current);
    setThemeTweaks(theme, {});
  };

  /**
   * Пресет не подставляет значения мгновенно: ручки едут к цели за треть
   * секунды. Так видно, ЧТО именно поменялось — иначе набор выглядит как
   * рывок картинки без объяснения.
   */
  const applyPreset = (patch: ThemeTweaks) => {
    if (tweenFrame.current) cancelAnimationFrame(tweenFrame.current);
    if (prefersReducedMotion()) {
      update(patch);
      return;
    }

    const from: Record<string, number> = {};
    const to: Record<string, number> = {};
    SLIDERS.forEach((slider) => {
      const target = patch[slider.key];
      if (typeof target !== 'number') return;
      from[slider.key] = tweaks[slider.key] ?? defaults?.[slider.key] ?? slider.min;
      to[slider.key] = target;
    });

    const started = performance.now();
    const duration = 320;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      const frame: ThemeTweaks = { ...patch };
      SLIDERS.forEach((slider) => {
        if (!(slider.key in to)) return;
        const value = from[slider.key] + (to[slider.key] - from[slider.key]) * eased;
        frame[slider.key] = snap(value, slider.min, slider.max, slider.step);
      });
      update(frame);
      tweenFrame.current = progress < 1 ? requestAnimationFrame(step) : null;
    };
    tweenFrame.current = requestAnimationFrame(step);
  };

  const copyCss = async () => {
    const ok = await copyTextToClipboard(tweaksToCss(theme, tweaks));
    setCopied(ok);
    setTimeout(() => setCopied(false), 1500);
  };

  const themeLabel = (THEME_LABELS as Record<string, string>)[theme] || theme;
  const touched = Object.keys(tweaks).length > 0;
  // Токен вспышки: любое изменение любой ручки меняет строку, сцена мигает.
  const pulseToken = useMemo(() => JSON.stringify(tweaks), [tweaks]);

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

    const origin = defaults?.[key];
    // Ручка без твика стоит там, где стоит ТЕМА, а не в начале шкалы: иначе
    // панель показывает «выключено» на теме, у которой размытие 34px.
    const value = tweaks[key] ?? origin ?? slider.min;
    const changed = tweaks[key] !== undefined;
    const originPercent =
      typeof origin === 'number'
        ? ((Math.min(slider.max, Math.max(slider.min, origin)) - slider.min) /
            (slider.max - slider.min)) * 100
        : null;

    return (
      <div key={key} className="px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-foreground">
            {t(`appearanceSettings.tweaks.${key}`)}
          </span>
          {/* Число, слово-характер и — только если ручку трогали — откуда она
              ушла. Постоянная подпись «как в теме» рядом со значением была бы
              третьим текстом в строке и читалась бы как ещё одна кнопка. */}
          <span className="flex items-center gap-2 text-xs">
            <span
              className={`tabular-nums ${changed ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
            >
              {formatValue(value, slider.step, slider.unit)}
            </span>
            <span className="text-muted-foreground">
              {t(`appearanceSettings.tweaks.hints.${key}.${levelOf(value, slider.min, slider.max)}`)}
            </span>
            {changed && (
              <>
                {typeof origin === 'number' && (
                  <span className="tabular-nums text-muted-foreground/70">
                    {t('appearanceSettings.tweaks.wasValue', {
                      value: formatValue(origin, slider.step, slider.unit),
                    })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => update({ [key]: undefined })}
                  title={t('appearanceSettings.tweaks.resetOne')}
                  aria-label={t('appearanceSettings.tweaks.resetOne')}
                  className="rounded-ui-sm p-0.5 text-muted-foreground transition-colors duration-fast ease-ui hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </>
            )}
          </span>
        </div>

        <div
          className="tweak-slider mt-2 flex items-center"
          style={originPercent === null ? undefined : ({ '--tweak-origin': `${originPercent}%` } as React.CSSProperties)}
        >
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={slider.step}
            value={value}
            aria-label={t(`appearanceSettings.tweaks.${key}`)}
            onChange={(event) => update({ [key]: Number(event.target.value) })}
            className="tweak-slider-input h-1 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          />
        </div>
      </div>
    );
  };

  return (
    <SettingsSection title={t('appearanceSettings.tweaks.title')}>
      <SettingsCard divided>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
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
            {/* Сцена липнет к верху списка: ручки материала оценивать не по
                чему, если превью уехало за край при прокрутке. */}
            <div className="sticky top-0 z-10 bg-card/95 px-4 py-3 backdrop-blur-sm">
              <ThemeTweakPreview
                pulseToken={pulseToken}
                labels={{
                  heading: t('appearanceSettings.tweaks.preview.heading'),
                  body: t('appearanceSettings.tweaks.preview.body'),
                  action: t('appearanceSettings.tweaks.preview.action'),
                  secondary: t('appearanceSettings.tweaks.preview.secondary'),
                  chip: t('appearanceSettings.tweaks.preview.chip'),
                }}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.patch)}
                    className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground shadow-1 transition-colors duration-fast ease-ui hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t(`appearanceSettings.tweaks.presets.${preset.id}`)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={reset}
                  disabled={!touched}
                  className="rounded-full border border-transparent px-3 py-1.5 text-xs text-muted-foreground transition-colors duration-fast ease-ui hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                >
                  {t('appearanceSettings.tweaks.presets.themeDefault')}
                </button>
              </div>
            </div>

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

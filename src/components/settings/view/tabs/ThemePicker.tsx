import React from 'react';
import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  NEON_VARIANTS,
  THEMES,
  THEME_LABELS,
  videoPosterFile,
} from '../../../../contexts/ThemeContext';
import { neonVariantFile } from '../../../../contexts/themeMigration';

type ThemePickerProps = {
  theme: string;
  neonVariant: string;
  onThemeChange: (theme: string) => void;
  onNeonVariantChange: (variant: string) => void;
  /** Быстрые настройки: узкая панель, карточки ниже. */
  compact?: boolean;
};

/**
 * Фото, которое тема показывает за стеклом. У «Оранжевой» это кадр её живых
 * обоев, у «Неона» — фото выбранного варианта; остальные темы плоские.
 */
const previewPhoto = (theme: string, neonVariant: string): string | null => {
  if (theme === 'ember') return videoPosterFile('ember', 'current') as string;
  if (theme === 'neon') return neonVariantFile(neonVariant) as string;
  return null;
};

const THEME_LABEL_MAP = THEME_LABELS as Record<string, string>;

/**
 * Карточка стоит на атрибуте `data-theme` показываемой темы: значения темы
 * (фон, акцент, стекло, шрифт, скругление) привязаны к нему и берутся из
 * index.css, а не нарисованы тут. Внутри только `style` с переменными — классы
 * вроде `bg-card` подхватили бы правила `[data-theme='…'] .bg-card` самой темы.
 */
function ThemeCard({
  id,
  selected,
  neonVariant,
  compact,
  onSelect,
}: {
  id: string;
  selected: boolean;
  neonVariant: string;
  compact: boolean;
  onSelect: () => void;
}) {
  const photo = previewPhoto(id, neonVariant);
  const cardStyle: CSSProperties = {
    borderRadius: 'calc(var(--radius) + 8px)',
    backgroundColor: 'var(--shell-bg)',
    backgroundImage: photo ? `url(${photo})` : 'var(--shell-material)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    color: 'hsl(var(--foreground))',
    fontFamily: 'var(--font-ui)',
    letterSpacing: 'var(--tracking-ui, normal)',
    outline: selected ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
    outlineOffset: selected ? '2px' : '-1px',
  };
  const glassStyle: CSSProperties = {
    borderRadius: 'calc(var(--radius) + 2px)',
    background: 'var(--glass-bg)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow)',
    backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
  };

  return (
    <button
      type="button"
      data-theme-card={id}
      data-theme={id}
      data-theme-variant={id === 'neon' ? neonVariant : undefined}
      aria-pressed={selected}
      onClick={onSelect}
      className={`relative flex w-full touch-manipulation flex-col justify-between overflow-hidden p-1.5 text-left transition-transform duration-150 active:scale-[0.98] ${
        compact ? 'min-h-[56px]' : 'min-h-[64px]'
      }`}
      style={cardStyle}
    >
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: 'hsl(var(--primary))', boxShadow: 'var(--shadow-2)' }}
        />
        <span
          className="h-1 w-9 rounded-full"
          style={{ background: 'hsl(var(--foreground) / 0.45)' }}
        />
      </span>
      <span className="flex items-center justify-between gap-1.5 px-2 py-1" style={glassStyle}>
        <span className="min-w-0 truncate text-xs font-semibold leading-tight">
          {THEME_LABEL_MAP[id] || id}
        </span>
        {selected && (
          <span
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full"
            style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </span>
    </button>
  );
}

export default function ThemePicker({
  theme,
  neonVariant,
  onThemeChange,
  onNeonVariantChange,
  compact = false,
}: ThemePickerProps) {
  const { t } = useTranslation('settings');
  const activeVariant = NEON_VARIANTS.find((variant) => variant.id === neonVariant);

  return (
    <div data-theme-picker>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {THEMES.map((id: string) => (
          <ThemeCard
            key={id}
            id={id}
            selected={theme === id}
            neonVariant={neonVariant}
            compact={compact}
            onSelect={() => onThemeChange(id)}
          />
        ))}
      </div>

      {theme === 'neon' && (
        <div className="mt-3">
          <div
            data-neon-variants
            role="group"
            aria-label={t('appearanceSettings.themePicker.neonColor', 'Цвет «Неона»')}
            className="grid grid-cols-4 justify-items-center gap-y-1 md:grid-cols-8"
          >
            {NEON_VARIANTS.map((variant: { id: string; label: string }) => {
              const selected = variant.id === neonVariant;
              return (
                <button
                  key={variant.id}
                  type="button"
                  data-neon-variant={variant.id}
                  aria-label={variant.label}
                  aria-pressed={selected}
                  onClick={() => onNeonVariantChange(variant.id)}
                  className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full"
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{
                      border: selected ? '2px solid hsl(var(--foreground))' : '2px solid transparent',
                    }}
                  >
                    <span
                      data-theme="neon"
                      data-theme-variant={variant.id}
                      className="h-6 w-6 rounded-full"
                      style={{ background: 'hsl(var(--primary))', boxShadow: 'var(--shadow-2)' }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
          {activeVariant && (
            <div className="mt-1 text-center text-xs text-muted-foreground">
              {t('appearanceSettings.themePicker.neonColorLabel', 'Цвет')}: {activeVariant.label}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

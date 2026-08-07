/**
 * Живая сцена для подстройки темы.
 *
 * Половина ручек — материал: размытие, прозрачность панели, зерно. Их эффект
 * физически не виден, пока сверху лежит модалка настроек, поэтому сцена
 * повторяет корпус приложения в миниатюре: тот же материал под панелью, та же
 * стеклянная карточка, та же кнопка. Всё на реальных классах и токенах, так
 * что превью не может разойтись с приложением.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';

type ThemeTweakPreviewProps = {
  /** Меняется на любое изменение ручки — сцена подтверждает вспышкой кромки. */
  pulseToken: string;
  labels: {
    heading: string;
    body: string;
    action: string;
    secondary: string;
    chip: string;
  };
};

export default function ThemeTweakPreview({ pulseToken, labels }: ThemeTweakPreviewProps) {
  const [pulsing, setPulsing] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    // Первый проход — не вспышка: панель просто открылась, ничего не крутили.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setPulsing(true);
    const timer = window.setTimeout(() => setPulsing(false), 430);
    return () => window.clearTimeout(timer);
  }, [pulseToken]);

  return (
    <div
      aria-hidden
      className={`tweak-stage relative overflow-hidden rounded-ui-lg border border-border ${
        pulsing ? 'tweak-stage-pulse' : ''
      }`}
    >
      <div className="relative m-3 rounded-ui-lg border border-border bg-card p-4 shadow-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{labels.heading}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{labels.body}</p>
          </div>
          {/* На узком экране чип съедает половину строки и режет заголовок
              многоточием — материал показывают панель и кнопка, чип тут
              необязателен. */}
          <span className="composer-chip hidden flex-shrink-0 items-center gap-1 rounded-ui-md border border-border px-2 py-1 text-[11px] text-muted-foreground sm:inline-flex">
            <Sparkles className="h-3 w-3" />
            {labels.chip}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            tabIndex={-1}
            className="inline-flex items-center gap-1.5 rounded-ui-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-1"
          >
            <Check className="h-3 w-3" />
            {labels.action}
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="rounded-ui-md border border-input bg-card px-3 py-1.5 text-xs text-foreground"
          >
            {labels.secondary}
          </button>
        </div>
      </div>
    </div>
  );
}

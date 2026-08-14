import type { ReactNode } from 'react';
import { AlertTriangle, Wrench, type LucideIcon } from 'lucide-react';

import type { Diagnosis } from './shared';

// Кирпичики вёрстки панели «Сервер»: кнопка действия, карточка, разбор аварии.

/** Кнопка действия: с подписью, а не голая иконка — с телефона иначе не угадать. */
export function ActionButton({
  icon: Icon,
  label,
  onClick,
  busy,
  danger,
  primary,
  title,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  primary?: boolean;
  title?: string;
}) {
  const accent = danger
    ? 'hover:border-red-500/60 hover:text-red-500'
    : primary
      ? 'border-primary/50 bg-primary/10 text-foreground hover:bg-primary/20'
      : 'hover:bg-accent hover:text-foreground';
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className={`flex min-h-[34px] items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors disabled:opacity-40 ${accent}`}
    >
      <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${busy ? 'animate-spin' : ''}`} />
      {label}
    </button>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{text}</div>;
}

export function Card({ title, icon: Icon, count, children }: { title: string; icon?: LucideIcon; count?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        {title}
        {count != null && <span className="text-xs font-normal text-muted-foreground">{count}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Разбор аварии: почему упал и что с этим делать. Без моделей — по правилам.
 *
 * Трассировка убрана под «Подробности»: на первом экране она пугает и вытесняет
 * кнопки, а Диме нужна одна фраза, что случилось. Кому нужен текст ошибки —
 * тот раскроет, и он тут же, а не в другой вкладке.
 */
export function DiagnosisBlock({ diagnosis }: { diagnosis: Diagnosis | null | undefined }) {
  if (!diagnosis) return null;
  if (!diagnosis.reason && !diagnosis.lastError) {
    return (
      <div className="mt-2 text-xs text-muted-foreground">
        По логам не понял, почему падает{diagnosis.exitCode != null ? ` (код выхода ${diagnosis.exitCode})` : ''}.
        Нажмите «Починить» — агент разберётся в чате.
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1.5">
      {diagnosis.reason && (
        <div className="flex items-start gap-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
          <div className="min-w-0">
            <div className="text-foreground">{diagnosis.reason}</div>
            {diagnosis.advice && <div className="mt-0.5 text-muted-foreground">→ {diagnosis.advice}</div>}
          </div>
        </div>
      )}

      {diagnosis.needsHuman && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <Wrench className="h-3 w-3 flex-shrink-0" />
          Сам не поднимется: перезапуск не поможет, нужна починка.
        </div>
      )}

      {diagnosis.lastError && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[11px] text-muted-foreground underline-offset-2 hover:underline">
            Подробности (текст ошибки)
          </summary>
          <div className="mt-1 overflow-hidden rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
            <span className="break-all">{diagnosis.lastError.slice(0, 600)}</span>
          </div>
        </details>
      )}
    </div>
  );
}

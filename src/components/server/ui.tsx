import type { ReactNode } from 'react';
import { AlertTriangle, type LucideIcon } from 'lucide-react';

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
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  primary?: boolean;
}) {
  const accent = danger
    ? 'hover:border-red-500/60 hover:text-red-500'
    : primary
      ? 'border-primary/50 text-foreground hover:bg-primary/10'
      : 'hover:bg-accent hover:text-foreground';
  return (
    <button
      onClick={onClick}
      disabled={busy}
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

/** Разбор аварии: почему упал и что с этим делать. Без моделей — по правилам. */
export function DiagnosisBlock({ diagnosis }: { diagnosis: Diagnosis | null | undefined }) {
  if (!diagnosis) return null;
  if (!diagnosis.reason && !diagnosis.lastError) {
    return (
      <div className="mt-2 text-xs text-muted-foreground">
        Причину по логам определить не вышло{diagnosis.exitCode != null ? ` (код выхода ${diagnosis.exitCode})` : ''}.
        Откройте логи — там видно больше.
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
      {diagnosis.lastError && (
        // Три строки — потолок: с телефона длинная трассировка выдавливает
        // кнопки за экран. Кому нужен весь текст, тот идёт в «Логи».
        <div
          className="overflow-hidden rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground"
          title={diagnosis.lastError}
        >
          <span className="line-clamp-3 break-all">{diagnosis.lastError.slice(0, 300)}</span>
        </div>
      )}
    </div>
  );
}

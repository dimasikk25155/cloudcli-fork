import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, ExternalLink, GitBranch, RotateCw } from 'lucide-react';

import { describeCodeStatus, describeSite, type ChipTone, type CodeStatus } from './codeStatusView';
import { useCodeStatus } from './useCodeStatus';

const TONE_CLASSES: Record<ChipTone, { chip: string; dot: string }> = {
  ok: {
    chip: 'border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  warn: {
    chip: 'border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  bad: {
    chip: 'border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  muted: {
    chip: 'border-border text-muted-foreground hover:bg-accent',
    dot: 'bg-muted-foreground',
  },
};

const SITE_DOT: Record<NonNullable<CodeStatus['site']>['state'], string> = {
  fresh: 'bg-emerald-500',
  up: 'bg-emerald-500',
  stale: 'bg-rose-500',
  down: 'bg-rose-500',
  unknown: 'bg-muted-foreground',
};

const PANEL_WIDTH = 320;

function formatTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Section({ title, total, items }: { title: string; total: number; items: string[] }) {
  if (total <= 0) return null;
  const rest = total - items.length;
  return (
    <div className="px-3 py-2">
      <p className="pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title} · {total}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item} className="truncate font-mono text-xs text-foreground" title={item}>
            {item}
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="pt-0.5 text-[11px] text-muted-foreground">и ещё {rest}</p>}
    </div>
  );
}

type CodeStatusChipProps = {
  projectId: string | null | undefined;
};

/** Чип «где мой код» в шапке чата: тап — список того, что не дошло до main и до сайта. */
export default function CodeStatusChip({ projectId }: CodeStatusChipProps) {
  const { status, loading, failed, refresh } = useCodeStatus(projectId);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Панель фиксированная и прижата к экрану: на 390px чип стоит в середине шапки.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      setPanelStyle({ position: 'fixed', top: rect.bottom + 6, left, width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => setOpen(false), [projectId]);

  const view = describeCodeStatus(status);
  if (!view || !status?.git) return null;

  const { git, site } = status;
  const tone = TONE_CLASSES[view.tone];
  const lists = git.lists ?? { files: [], notInMain: [], unpushed: [] };
  const clean = git.uncommitted === 0 && (git.notInMain === 0 || !git.mainBranch) && git.unpushed === 0;
  const deployedAt = formatTime(site?.deployedAt);
  const checkedAt = formatTime(status.checkedAt);

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={view.label}
        aria-label={`Код проекта: ${view.label}`}
        aria-expanded={open}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors sm:h-7 sm:w-auto sm:gap-1.5 sm:rounded-full sm:border sm:px-2 sm:text-xs sm:font-medium ${tone.chip}`}
      >
        {/* Телефон: значок ветки цвета состояния и число; шире — подпись. */}
        <GitBranch className="h-4 w-4 sm:hidden" strokeWidth={2.2} />
        {view.count != null ? (
          <span
            className={`absolute -right-0.5 -top-0.5 min-w-[1rem] rounded-full px-1 text-center text-[10px] font-semibold leading-4 text-white sm:hidden ${tone.dot}`}
          >
            {view.count > 99 ? '99+' : view.count}
          </span>
        ) : view.mark === 'alert' ? (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[11px] font-bold leading-none text-white sm:hidden ${tone.dot}`}
          >
            !
          </span>
        ) : (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white sm:hidden ${tone.dot}`}
          >
            <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
          </span>
        )}
        <span className={`hidden h-1.5 w-1.5 flex-shrink-0 rounded-full sm:block ${tone.dot}`} />
        <span className="hidden whitespace-nowrap sm:inline">{view.label}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          style={panelStyle}
          role="dialog"
          aria-label="Где мой код"
          className="z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <GitBranch className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={git.branch}>
              {git.branch}
            </span>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
            >
              <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </button>
          </div>

          <Section title="Несохранённые файлы" total={git.uncommitted} items={lists.files} />
          {git.mainBranch && (
            <Section title={`Не в ${git.mainBranch}`} total={git.notInMain} items={lists.notInMain} />
          )}
          <Section title="Не отправлено" total={git.unpushed} items={lists.unpushed} />

          {clean && (
            <p className="px-3 py-2 text-sm text-foreground">
              {git.mainBranch ? `Всё сохранено и в ${git.mainBranch}` : 'Всё сохранено'}
              {git.hasRemote ? ', отправлено' : ''}
            </p>
          )}

          {site && (
            <div className="border-t border-border/60 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${SITE_DOT[site.state]}`} />
                <span className="text-foreground">Сайт: {describeSite(site)}</span>
              </div>
              {site.url && (
                <a
                  href={site.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 block truncate pl-4 text-xs text-primary hover:underline"
                >
                  {hostOf(site.url)}
                </a>
              )}
              {deployedAt && (
                <p className="pl-4 text-[11px] text-muted-foreground">
                  Сборка {deployedAt}
                  {site.sha ? ` · ${site.sha.slice(0, 7)}` : ''}
                </p>
              )}
              {site.previewUrl && (
                <a
                  href={site.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Превью
                </a>
              )}
            </div>
          )}

          <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
            {failed ? 'Не удалось обновить — показаны прежние данные' : checkedAt ? `Проверено ${checkedAt}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

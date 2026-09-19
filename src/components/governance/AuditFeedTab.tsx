import { useMemo, useState } from 'react';

import {
  ACTOR_LABELS,
  EVENT_LABELS,
  formatMoscowTime,
  formatTokens,
  formatUsd,
  projectName,
  type AuditEventRow,
} from './types';

// Лента событий. Группируется по прогону, а не по строкам: человека интересует
// «что сделал вот этот запуск», а не поток отдельных записей. Внутри группы
// строки идут как есть — это и есть таймлайн прогона.

type RunGroup = {
  runId: string;
  rows: AuditEventRow[];
  start: AuditEventRow | null;
  finish: AuditEventRow | null;
};

const ACTOR_TONE: Record<string, string> = {
  user: 'bg-blue-500/15 text-blue-500',
  schedule: 'bg-purple-500/15 text-purple-400',
  pipeline: 'bg-purple-500/15 text-purple-400',
  telegram: 'bg-sky-500/15 text-sky-400',
  api: 'bg-amber-500/15 text-amber-500',
  'git-helper': 'bg-muted text-muted-foreground',
  system: 'bg-muted text-muted-foreground',
};

function groupByRun(events: AuditEventRow[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();

  for (const row of events) {
    // Строка без run_id (если такая появится) не должна пропасть из ленты —
    // ей выдаётся собственная группа по id.
    const key = row.run_id ?? `row-${row.id}`;
    const existing = groups.get(key);
    const group = existing ?? { runId: key, rows: [], start: null, finish: null };

    group.rows.push(row);
    if (row.event === 'run.start') group.start = row;
    if (row.event === 'run.finish' || row.event === 'run.error') group.finish = row;

    if (!existing) groups.set(key, group);
  }

  return [...groups.values()];
}

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone}`}>{children}</span>;
}

function RunCard({ group }: { group: RunGroup }) {
  const [open, setOpen] = useState(false);

  const head = group.finish ?? group.start ?? group.rows[0];
  const failed = group.finish?.event === 'run.error' || group.finish?.outcome === 'error';
  // Прогон, у которого есть старт, но нет финала — это либо ещё идущий, либо
  // упавший так, что до записи финала не дошло. Оба случая стоит видеть.
  const unfinished = Boolean(group.start) && !group.finish;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
      >
        <span className="w-[86px] flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatMoscowTime(head.ts)}
        </span>

        <Badge tone={ACTOR_TONE[head.actor] ?? ACTOR_TONE.system}>
          {ACTOR_LABELS[head.actor] ?? head.actor}
        </Badge>

        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
          {projectName(head.project_path)}
          {head.model && <span className="ml-2 text-muted-foreground">{head.model}</span>}
        </span>

        {failed && <Badge tone="bg-red-500/15 text-red-500">ошибка</Badge>}
        {unfinished && <Badge tone="bg-amber-500/15 text-amber-500">не завершён</Badge>}

        <span className="w-[70px] flex-shrink-0 text-right text-xs tabular-nums text-foreground">
          {group.finish ? formatUsd(group.finish.usd) : '—'}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-2">
          {group.rows.map((row) => (
            <div key={row.id} className="flex items-start gap-2 py-1 text-[11px]">
              <span className="w-[86px] flex-shrink-0 tabular-nums text-muted-foreground">
                {formatMoscowTime(row.ts)}
              </span>
              <span className="w-[120px] flex-shrink-0 text-muted-foreground">
                {EVENT_LABELS[row.event] ?? row.event}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/80">
                {row.detail || '—'}
              </span>
            </div>
          ))}

          {group.finish && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
              <span>вход: {formatTokens(group.finish.tokens_in)}</span>
              <span>выход: {formatTokens(group.finish.tokens_out)}</span>
              <span>из кэша: {formatTokens(group.finish.cache_read)}</span>
              {group.finish.duration_ms !== null && (
                <span>время: {Math.round(group.finish.duration_ms / 1000)} с</span>
              )}
              {group.finish.usd === 0 && (
                <span title="Движок работает по подписке — опубликованных цен за токен у него нет">
                  цена неизвестна
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AuditFeedTab({ events }: { events: AuditEventRow[] }) {
  const groups = useMemo(() => groupByRun(events), [events]);

  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        Журнал пока пуст. Он начинает заполняться с первого прогона после обновления.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((group) => (
        <RunCard key={group.runId} group={group} />
      ))}
    </div>
  );
}

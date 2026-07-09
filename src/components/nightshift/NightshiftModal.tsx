import { useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { api } from '../../utils/api';

// Read-only view of the night-shift orchestrator: scheduled launchd runs and
// their history (see ~/.claude/skills/night-shift on the host Mac).

type ScheduledRun = {
  label: string;
  hour: number | null;
  minute: number | null;
};

type HistoryRun = {
  label: string;
  status: 'ok' | 'fail' | 'pending';
  attempts: number | null;
  finishedAt: string | null;
  updatedAt: string;
  logTail: string[];
  resultPreview: string;
};

type NightshiftData = {
  scheduled: ScheduledRun[];
  history: HistoryRun[];
};

const STATUS_BADGE: Record<HistoryRun['status'], string> = {
  ok: '✅',
  fail: '❌',
  pending: '⏳',
};

function formatTime(hour: number | null, minute: number | null): string {
  if (hour === null) {
    return '—';
  }
  return `${String(hour).padStart(2, '0')}:${String(minute ?? 0).padStart(2, '0')}`;
}

export default function NightshiftModal({ onClose, t }: { onClose: () => void; t: TFunction }) {
  const [data, setData] = useState<NightshiftData | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.nightshift()
      .then(async (response: Response) => {
        if (!response.ok) throw new Error(String(response.status));
        const json = await response.json();
        if (!cancelled) setData({ scheduled: json.scheduled ?? [], history: json.history ?? [] });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 md:items-center md:p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-background md:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{t('nightshift.title')}</h2>
          </div>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
            onClick={onClose}
            aria-label={t('nightshift.close')}
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="text-sm text-muted-foreground">{t('nightshift.error')}</p>}
          {!data && !error && <p className="text-sm text-muted-foreground">{t('nightshift.loading')}</p>}

          {data && (
            <>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('nightshift.scheduled')}
              </h3>
              {data.scheduled.length === 0 ? (
                <p className="mb-4 text-sm text-muted-foreground/70">{t('nightshift.empty')}</p>
              ) : (
                <div className="mb-4 space-y-1.5">
                  {data.scheduled.map((run) => (
                    <div key={run.label} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2">
                      <span className="font-mono text-sm font-semibold text-primary">{formatTime(run.hour, run.minute)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{run.label}</span>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('nightshift.history')}
              </h3>
              {data.history.length === 0 ? (
                <p className="text-sm text-muted-foreground/70">{t('nightshift.empty')}</p>
              ) : (
                <div className="space-y-1.5">
                  {data.history.map((run) => (
                    <div key={run.label} className="rounded-lg border border-border/50 bg-card">
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-left"
                        onClick={() => setExpanded(expanded === run.label ? null : run.label)}
                      >
                        <span>{STATUS_BADGE[run.status]}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{run.label}</span>
                        {run.attempts !== null && run.attempts > 1 && (
                          <span className="flex-shrink-0 text-[11px] text-muted-foreground">×{run.attempts}</span>
                        )}
                        <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                          {new Date(run.updatedAt).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </button>
                      {expanded === run.label && (
                        <div className="border-t border-border/50 px-3 py-2">
                          {run.logTail.length > 0 && (
                            <pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
                              {run.logTail.join('\n')}
                            </pre>
                          )}
                          {run.resultPreview && (
                            <p className="whitespace-pre-wrap break-words text-xs text-foreground/80">{run.resultPreview}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

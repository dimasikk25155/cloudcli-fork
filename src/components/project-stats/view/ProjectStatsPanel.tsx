import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, FileCode2, HardDrive, Coins, MessageSquare, RefreshCw, AlertTriangle } from 'lucide-react';

import type { Project } from '../../../types/app';
import { fetchProjectStats, formatBytes, formatCount, type ProjectStats } from '../../../utils/projectStats';
import { formatTokensShort, formatUsd } from '../../../utils/usageHistory';

type ProjectStatsPanelProps = {
  selectedProject: Project;
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" strokeWidth={1.8} />
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function ProjectStatsPanel({ selectedProject }: ProjectStatsPanelProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const projectPath = selectedProject.fullPath || selectedProject.path || '';

  const load = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      setStats(await fetchProjectStats(projectPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !stats) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('stats.loading', { defaultValue: 'Считаю…' })}
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <span>{error}</span>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-muted"
        >
          {t('stats.retry', { defaultValue: 'Повторить' })}
        </button>
      </div>
    );
  }

  if (!stats) return null;

  const maxLines = Math.max(...stats.languages.map((l) => l.lines), 1);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          {/* Folder name, not the project uuid — the uuid meant nothing to a human. */}
          <h2 className="truncate text-lg font-semibold text-foreground">{stats.name}</h2>
          <p className="truncate text-xs text-muted-foreground">{stats.path}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
          {t('stats.refresh', { defaultValue: 'Обновить' })}
        </button>
      </div>

      {stats.truncated && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span>
            {t('stats.truncated', {
              defaultValue: 'Проект больше 20 000 файлов — показаны неполные числа.',
            })}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          icon={FileCode2}
          label={t('stats.files', { defaultValue: 'Файлы' })}
          value={formatCount(stats.files)}
        />
        <StatCard
          icon={BarChart3}
          label={t('stats.lines', { defaultValue: 'Строки кода' })}
          value={formatCount(stats.lines)}
        />
        <StatCard
          icon={HardDrive}
          label={t('stats.size', { defaultValue: 'Объём' })}
          value={formatBytes(stats.bytes)}
        />
        <StatCard
          icon={MessageSquare}
          label={t('stats.sessions', { defaultValue: 'Сессии с Claude' })}
          value={formatCount(stats.sessions)}
          hint={
            stats.lastActivity
              ? t('stats.lastActivity', {
                  defaultValue: 'последняя {{date}}',
                  date: new Date(stats.lastActivity).toLocaleDateString('ru-RU'),
                })
              : undefined
          }
        />
        <StatCard
          icon={Coins}
          label={t('stats.tokens', { defaultValue: 'Потрачено токенов' })}
          value={formatTokensShort(stats.tokens)}
        />
        <StatCard
          icon={Coins}
          label={t('stats.cost', { defaultValue: 'Стоимость по API' })}
          value={formatUsd(stats.costUsd)}
          hint={t('stats.costHint', { defaultValue: 'на подписке это лимит, а не деньги' })}
        />
      </div>

      {stats.languages.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
            {t('stats.languages', { defaultValue: 'Из чего состоит' })}
          </h3>
          <div className="space-y-2">
            {stats.languages.map((lang) => (
              <div key={lang.ext} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-sm text-foreground">{lang.ext}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max((lang.lines / maxLines) * 100, 2)}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                  {formatCount(lang.lines)} · {formatCount(lang.files)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Play, Plus, Trash2 } from 'lucide-react';

import { authenticatedFetch } from '../../utils/api';

// Recurring unattended runs (/api/schedules). Strings live here rather than in
// src/i18n because this panel is Neo3-specific and the locale files are shared.

type Schedule = {
  id: number;
  name: string;
  kind: string;
  projectPath: string | null;
  prompt: string;
  pipelineId: number | null;
  hour: number;
  minute: number;
  weekdays: number[];
  enabled: boolean;
  osLabel: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
};

type HostStatus = { platform: string; supported: boolean };

type ProjectOption = { fullPath: string; displayName: string };

type PipelineOption = { id: number; name: string };

const WEEKDAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const EMPTY_FORM = {
  name: '',
  kind: 'prompt' as 'prompt' | 'pipeline',
  projectPath: '',
  prompt: '',
  pipelineId: '',
  time: '09:00',
  weekdays: [] as number[],
};

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatWeekdays(weekdays: number[]): string {
  if (weekdays.length === 0) return 'ежедневно';
  return weekdays.map((day) => WEEKDAY_LABELS[day]).join(', ');
}

/** A deleted pipeline nulls the FK, so the schedule can outlive its target. */
function pipelineName(pipelineId: number | null, options: PipelineOption[]): string {
  const found = options.find((option) => option.id === pipelineId);
  return found ? `сценарий «${found.name}»` : 'сценарий удалён';
}

/** SQLite stores CURRENT_TIMESTAMP as UTC without a zone marker. */
function formatRunTimestamp(value: string | null): string {
  if (!value) return 'ещё не запускалось';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const json = await response.json();
    return json?.error?.message || json?.error || fallback;
  } catch {
    return fallback;
  }
}

export default function SchedulesPanel({ className = '' }: { className?: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [host, setHost] = useState<HostStatus | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/schedules');
      if (!response.ok) {
        throw new Error(await readError(response, 'Не удалось загрузить расписания'));
      }
      const json = await response.json();
      setSchedules(json?.data?.schedules ?? []);
      setHost(json?.data?.host ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить расписания');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    // skipSync keeps this from triggering a full project rescan just to fill a dropdown.
    authenticatedFetch('/api/projects?skipSync=1')
      .then((response: Response) => (response.ok ? response.json() : []))
      .then((list: unknown) => {
        if (cancelled || !Array.isArray(list)) return;
        setProjects(
          list
            .filter((item): item is ProjectOption => Boolean(item && typeof item.fullPath === 'string'))
            .map((item) => ({ fullPath: item.fullPath, displayName: item.displayName || item.fullPath }))
        );
      })
      .catch(() => {
        // The dropdown falls back to a plain text field when projects cannot be listed.
      });

    // Scenarios a schedule can start instead of a one-off prompt.
    authenticatedFetch('/api/pipelines')
      .then((response: Response) => (response.ok ? response.json() : null))
      .then((json: unknown) => {
        if (cancelled) return;
        const list = (json as { data?: { pipelines?: unknown } } | null)?.data?.pipelines;
        if (!Array.isArray(list)) return;
        setPipelines(
          list
            .filter((item): item is PipelineOption => Boolean(item && typeof item.id === 'number'))
            .map((item) => ({ id: item.id, name: item.name || `Сценарий #${item.id}` }))
        );
      })
      .catch(() => {
        // No scenarios reachable — the form simply stays on the prompt tab.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleWeekday = (day: number) => {
    setForm((previous) => ({
      ...previous,
      weekdays: previous.weekdays.includes(day)
        ? previous.weekdays.filter((value) => value !== day)
        : [...previous.weekdays, day].sort((a, b) => a - b),
    }));
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const [hourPart, minutePart] = form.time.split(':');
    setCreating(true);
    try {
      const response = await authenticatedFetch('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          kind: form.kind,
          // Only the fields the chosen kind uses: a pipeline carries its own
          // project per step, so it keeps no project or prompt of its own.
          ...(form.kind === 'pipeline'
            ? { pipelineId: Number(form.pipelineId) }
            : { projectPath: form.projectPath, prompt: form.prompt }),
          hour: Number.parseInt(hourPart, 10),
          minute: Number.parseInt(minutePart, 10),
          weekdays: form.weekdays,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Не удалось создать расписание'));
      }
      setForm(EMPTY_FORM);
      setFormOpen(false);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Не удалось создать расписание');
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (schedule: Schedule) => {
    setBusyId(schedule.id);
    try {
      const response = await authenticatedFetch(`/api/schedules/${schedule.id}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Не удалось переключить расписание'));
      }
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Не удалось переключить расписание');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (schedule: Schedule) => {
    setBusyId(schedule.id);
    try {
      const response = await authenticatedFetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(await readError(response, 'Не удалось удалить расписание'));
      }
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить расписание');
    } finally {
      setBusyId(null);
    }
  };

  const handleRunNow = async (schedule: Schedule) => {
    setBusyId(schedule.id);
    try {
      const response = await authenticatedFetch(`/api/schedules/${schedule.id}/run`, { method: 'POST' });
      if (!response.ok) {
        throw new Error(await readError(response, 'Прогон не удался'));
      }
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Прогон не удался');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={`flex h-full flex-col overflow-hidden ${className}`}>
      {/* Title lives in the modal chrome; this strip only carries the action. */}
      <div className="flex flex-shrink-0 items-center justify-end border-b border-border px-4 py-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          onClick={() => setFormOpen((open) => !open)}
        >
          <Plus className="h-3.5 w-3.5" />
          {formOpen ? 'Отмена' : 'Новое'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {host && !host.supported && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <p className="text-xs text-foreground/80">
              Эта система ({host.platform}) не умеет запускать расписания. Нужен macOS или Linux.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="text-xs text-foreground/80">{error}</p>
            <button
              type="button"
              className="flex-shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setError(null)}
            >
              скрыть
            </button>
          </div>
        )}

        {formOpen && (
          <form className="mb-4 space-y-3 rounded-lg border border-border bg-card p-3" onSubmit={handleCreate}>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Название</label>
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder="Утренний отчёт"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </div>

            {pipelines.length > 0 && (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Что запускать</label>
                <div className="flex gap-1.5">
                  {([
                    ['prompt', 'Промпт'],
                    ['pipeline', 'Сценарий'],
                  ] as const).map(([kind, label]) => (
                    <button
                      key={kind}
                      type="button"
                      className={`flex-1 rounded-lg border px-3 py-1.5 text-xs ${
                        form.kind === kind
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground'
                      }`}
                      onClick={() => setForm({ ...form, kind })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {form.kind === 'pipeline' ? (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Сценарий</label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={form.pipelineId}
                  onChange={(event) => setForm({ ...form, pipelineId: event.target.value })}
                  required
                >
                  <option value="">Выберите сценарий</option>
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  Проект и промпт берутся из шагов сценария.
                </p>
              </div>
            ) : (
              <>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Проект</label>
              {projects.length > 0 ? (
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={form.projectPath}
                  onChange={(event) => setForm({ ...form, projectPath: event.target.value })}
                  required
                >
                  <option value="">Выберите проект</option>
                  {projects.map((project) => (
                    <option key={project.fullPath} value={project.fullPath}>
                      {project.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                  placeholder="/Users/me/projects/app"
                  value={form.projectPath}
                  onChange={(event) => setForm({ ...form, projectPath: event.target.value })}
                  required
                />
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Промпт</label>
              <textarea
                className="min-h-[72px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder="Что агент должен сделать"
                value={form.prompt}
                onChange={(event) => setForm({ ...form, prompt: event.target.value })}
                required
              />
            </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Время</label>
              <input
                type="time"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={form.time}
                onChange={(event) => setForm({ ...form, time: event.target.value })}
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Дни недели (ничего не выбрано — каждый день)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABELS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    className={`h-8 w-10 rounded-lg border text-xs ${
                      form.weekdays.includes(day)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                    onClick={() => toggleWeekday(day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              disabled={creating}
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Создать расписание
            </button>
          </form>
        )}

        {loading && <p className="text-sm text-muted-foreground">Загружаю…</p>}

        {!loading && schedules.length === 0 && (
          <p className="text-sm text-muted-foreground/70">Расписаний пока нет.</p>
        )}

        <div className="space-y-2">
          {schedules.map((schedule) => (
            <div key={schedule.id} className="rounded-lg border border-border/60 bg-card p-3">
              <div className="flex items-start gap-3">
                <span className="font-mono text-sm font-semibold text-primary">
                  {formatTime(schedule.hour, schedule.minute)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{schedule.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {formatWeekdays(schedule.weekdays)} ·{' '}
                    {schedule.kind === 'pipeline'
                      ? pipelineName(schedule.pipelineId, pipelines)
                      : schedule.projectPath || 'проект не указан'}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={schedule.enabled}
                  aria-label={schedule.enabled ? 'Выключить расписание' : 'Включить расписание'}
                  className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
                    schedule.enabled ? 'bg-primary' : 'bg-muted'
                  } disabled:opacity-50`}
                  disabled={busyId === schedule.id}
                  onClick={() => handleToggle(schedule)}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                      schedule.enabled ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {schedule.kind === 'pipeline' ? (
                <p className="mt-2 truncate text-[11px] text-muted-foreground/80">
                  Сценарий целиком — шаги задают проект и промпт.
                </p>
              ) : (
                <p className="mt-2 truncate text-[11px] text-muted-foreground/80" title={schedule.prompt}>
                  {schedule.prompt}
                </p>
              )}

              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  Последний прогон: {formatRunTimestamp(schedule.lastRunAt)}
                  {schedule.lastStatus ? ` · ${schedule.lastStatus === 'ok' ? '✅ успех' : `❌ ${schedule.lastStatus}`}` : ''}
                </p>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-accent disabled:opacity-50"
                    title="Запустить сейчас"
                    aria-label="Запустить сейчас"
                    disabled={busyId === schedule.id}
                    onClick={() => handleRunNow(schedule)}
                  >
                    {busyId === schedule.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <Play className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-accent disabled:opacity-50"
                    title="Удалить"
                    aria-label="Удалить расписание"
                    disabled={busyId === schedule.id}
                    onClick={() => handleDelete(schedule)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

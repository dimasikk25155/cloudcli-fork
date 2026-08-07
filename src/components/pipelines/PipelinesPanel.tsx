import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '../../shared/view/ui';
import { authenticatedFetch } from '../../utils/api';

// Сценарии (pipelines): несколько промптов подряд, каждый в своём проекте.
// Вывод шага подставляется в следующий через {{prev}} и {{step:N}}.
// Строки здесь заданы прямо в компоненте — общие файлы i18n трогать нельзя.

type PipelineStep = {
  name: string;
  projectPath: string;
  prompt: string;
};

type Pipeline = {
  id: number;
  name: string;
  description: string;
  steps: PipelineStep[];
  createdAt: string;
  updatedAt: string;
};

type PipelineRun = {
  id: number;
  pipelineId: number;
  pipelineName: string;
  status: string;
  trigger: string;
  artifactsDir: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type PipelineRunStep = {
  stepIndex: number;
  name: string;
  projectPath: string;
  prompt: string;
  status: string;
  sessionId: string | null;
  outputPreview: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type ProjectOption = {
  fullPath: string;
  displayName: string;
};

type Draft = {
  id: number | null;
  name: string;
  description: string;
  steps: PipelineStep[];
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'в очереди',
  running: 'идёт',
  completed: 'готово',
  failed: 'ошибка',
  canceled: 'отменён',
  skipped: 'пропущен',
};

const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/15 text-blue-500',
  completed: 'bg-emerald-500/15 text-emerald-500',
  failed: 'bg-red-500/15 text-red-500',
  canceled: 'bg-amber-500/15 text-amber-500',
  skipped: 'bg-muted text-muted-foreground',
};

const ACTIVE_STATUSES = new Set(['pending', 'running']);

function emptyStep(index: number): PipelineStep {
  return { name: `Шаг ${index}`, projectPath: '', prompt: '' };
}

function emptyDraft(): Draft {
  return { id: null, name: 'Новый сценарий', description: '', steps: [emptyStep(1)] };
}

async function callApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(url, options);
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message || `Ошибка запроса (${response.status})`);
  }

  return payload.data as T;
}

function formatMoment(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status] || STATUS_CLASSES.pending}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function PipelinesPanel() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [openRun, setOpenRun] = useState<{ run: PipelineRun; steps: PipelineRunStep[] } | null>(null);
  const [stepOutput, setStepOutput] = useState<{ title: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const openRunIdRef = useRef<number | null>(null);

  const loadPipelines = useCallback(async () => {
    const data = await callApi<{ pipelines: Pipeline[] }>('/api/pipelines');
    setPipelines(data.pipelines);
    return data.pipelines;
  }, []);

  const loadRuns = useCallback(async (pipelineId: number) => {
    const data = await callApi<{ runs: PipelineRun[] }>(`/api/pipelines/${pipelineId}/runs`);
    setRuns(data.runs);
  }, []);

  const loadRun = useCallback(async (runId: number) => {
    const data = await callApi<{ run: PipelineRun; steps: PipelineRunStep[] }>(`/api/pipelines/runs/${runId}`);
    setOpenRun(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [loaded, projectsResponse] = await Promise.all([
          loadPipelines(),
          authenticatedFetch('/api/projects?skipSync=1').then((response: Response) => response.json()),
        ]);

        if (cancelled) return;

        const options: ProjectOption[] = Array.isArray(projectsResponse)
          ? projectsResponse
              .filter((project: ProjectOption) => Boolean(project?.fullPath))
              .map((project: ProjectOption) => ({
                fullPath: project.fullPath,
                displayName: project.displayName || project.fullPath,
              }))
          : [];
        setProjects(options);

        if (loaded.length > 0) {
          setDraft({ ...loaded[0], id: loaded[0].id });
          await loadRuns(loaded[0].id);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить сценарии');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadPipelines, loadRuns]);

  // Прогон длинный и идёт на сервере — состояние тянем поллингом, пока он не завершится.
  useEffect(() => {
    openRunIdRef.current = openRun?.run.id ?? null;
    if (!openRun || !ACTIVE_STATUSES.has(openRun.run.status)) {
      return;
    }

    const timer = setInterval(() => {
      const runId = openRunIdRef.current;
      if (runId === null) return;
      loadRun(runId)
        .then((data) => {
          if (!ACTIVE_STATUSES.has(data.run.status)) {
            void loadRuns(data.run.pipelineId).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 2000);

    return () => clearInterval(timer);
  }, [openRun, loadRun, loadRuns]);

  const selectPipeline = async (pipeline: Pipeline) => {
    setError(null);
    setOpenRun(null);
    setStepOutput(null);
    setDraft({ ...pipeline, id: pipeline.id });
    try {
      await loadRuns(pipeline.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить историю');
    }
  };

  const savePipeline = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);

    try {
      const body = JSON.stringify({ name: draft.name, description: draft.description, steps: draft.steps });
      const data = draft.id
        ? await callApi<{ pipeline: Pipeline }>(`/api/pipelines/${draft.id}`, { method: 'PUT', body })
        : await callApi<{ pipeline: Pipeline }>('/api/pipelines', { method: 'POST', body });

      await loadPipelines();
      setDraft({ ...data.pipeline, id: data.pipeline.id });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить сценарий');
    } finally {
      setSaving(false);
    }
  };

  const deletePipeline = async () => {
    if (!draft?.id) return;
    setError(null);

    try {
      await callApi(`/api/pipelines/${draft.id}`, { method: 'DELETE' });
      const remaining = await loadPipelines();
      setRuns([]);
      setOpenRun(null);
      setDraft(remaining.length > 0 ? { ...remaining[0], id: remaining[0].id } : null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить сценарий');
    }
  };

  const runPipeline = async () => {
    if (!draft?.id) return;
    setError(null);

    try {
      const data = await callApi<{ runId: number }>(`/api/pipelines/${draft.id}/run`, { method: 'POST' });
      await loadRuns(draft.id);
      await loadRun(data.runId);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Не удалось запустить сценарий');
    }
  };

  const cancelRun = async (runId: number) => {
    setError(null);
    try {
      await callApi(`/api/pipelines/runs/${runId}/cancel`, { method: 'POST' });
      await loadRun(runId);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Не удалось остановить прогон');
    }
  };

  const showStepOutput = async (runId: number, step: PipelineRunStep) => {
    setError(null);
    try {
      const data = await callApi<{ output: string; name: string }>(
        `/api/pipelines/runs/${runId}/steps/${step.stepIndex}/output`,
      );
      setStepOutput({ title: `${step.stepIndex}. ${step.name}`, text: data.output || 'Вывод пуст' });
    } catch (outputError) {
      setStepOutput({
        title: `${step.stepIndex}. ${step.name}`,
        text: step.outputPreview || (outputError instanceof Error ? outputError.message : 'Вывод недоступен'),
      });
    }
  };

  const patchStep = (index: number, patch: Partial<PipelineStep>) => {
    setDraft((current) =>
      current
        ? { ...current, steps: current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) }
        : current,
    );
  };

  const moveStep = (index: number, offset: number) => {
    setDraft((current) => {
      if (!current) return current;
      const target = index + offset;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps };
    });
  };

  const addStep = () => {
    setDraft((current) => (current ? { ...current, steps: [...current.steps, emptyStep(current.steps.length + 1)] } : current));
  };

  const removeStep = (index: number) => {
    setDraft((current) =>
      current && current.steps.length > 1
        ? { ...current, steps: current.steps.filter((_, i) => i !== index) }
        : current,
    );
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Загружаем сценарии…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Title lives in the modal chrome; this strip only carries the action. */}
      <div className="flex items-center justify-end border-b border-border px-4 py-2">
        <button
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent"
          onClick={() => {
            setDraft(emptyDraft());
            setRuns([]);
            setOpenRun(null);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Новый
        </button>
      </div>

      {error && (
        <div className="border-b border-border bg-red-500/10 px-4 py-2 text-xs text-red-500">{error}</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-border p-3 md:w-56 md:border-b-0 md:border-r lg:w-64">
          {pipelines.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">
              Сценариев пока нет. Создайте первый — он выполнит несколько промптов подряд.
            </p>
          )}
          <div className="space-y-1">
            {pipelines.map((pipeline) => (
              <button
                key={pipeline.id}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent ${
                  draft?.id === pipeline.id ? 'bg-accent' : ''
                }`}
                onClick={() => void selectPipeline(pipeline)}
              >
                <div className="truncate font-medium">{pipeline.name}</div>
                <div className="truncate text-xs text-muted-foreground">{pipeline.steps.length} шаг(ов)</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
          {!draft ? (
            <p className="text-sm text-muted-foreground">Выберите сценарий слева или создайте новый.</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <input
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  value={draft.name}
                  placeholder="Название сценария"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
                <input
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  value={draft.description}
                  placeholder="Зачем этот сценарий (необязательно)"
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>

              <p className="rounded-lg border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
                В промпте шага можно подставить вывод прошлых шагов:{' '}
                <code className="text-foreground">{'{{prev}}'}</code> — вывод предыдущего шага,{' '}
                <code className="text-foreground">{'{{step:2}}'}</code> — вывод второго шага.
              </p>

              <div className="space-y-3">
                {draft.steps.map((step, index) => (
                  <div key={index} className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                        {index + 1}
                      </span>
                      <input
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                        value={step.name}
                        placeholder="Название шага"
                        onChange={(event) => patchStep(index, { name: event.target.value })}
                      />
                      <button
                        className="rounded-md p-1.5 hover:bg-accent disabled:opacity-30"
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                        aria-label="Выше"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded-md p-1.5 hover:bg-accent disabled:opacity-30"
                        disabled={index === draft.steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                        aria-label="Ниже"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded-md p-1.5 text-red-500 hover:bg-accent disabled:opacity-30"
                        disabled={draft.steps.length === 1}
                        onClick={() => removeStep(index)}
                        aria-label="Удалить шаг"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <select
                      className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      value={step.projectPath}
                      onChange={(event) => patchStep(index, { projectPath: event.target.value })}
                    >
                      <option value="">— выберите проект —</option>
                      {step.projectPath && !projects.some((project) => project.fullPath === step.projectPath) && (
                        <option value={step.projectPath}>{step.projectPath} (нет доступа?)</option>
                      )}
                      {projects.map((project) => (
                        <option key={project.fullPath} value={project.fullPath}>
                          {project.displayName}
                        </option>
                      ))}
                    </select>

                    <textarea
                      className="min-h-[90px] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
                      value={step.prompt}
                      placeholder="Что сделать на этом шаге"
                      onChange={(event) => patchStep(index, { prompt: event.target.value })}
                    />

                    {index > 0 && (
                      <button
                        className="mt-1 text-xs text-primary hover:underline"
                        onClick={() => patchStep(index, { prompt: `${step.prompt}{{prev}}` })}
                      >
                        + вставить {'{{prev}}'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                  onClick={addStep}
                >
                  <Plus className="h-4 w-4" />
                  Добавить шаг
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  disabled={saving}
                  onClick={() => void savePipeline()}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Сохранить
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-40"
                  disabled={!draft.id}
                  onClick={() => void runPipeline()}
                  title={draft.id ? 'Запустить сценарий' : 'Сначала сохраните сценарий'}
                >
                  <Play className="h-4 w-4" />
                  Запустить
                </button>
                {draft.id && (
                  <button
                    className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-red-500 hover:bg-accent"
                    onClick={() => void deletePipeline()}
                  >
                    <Trash2 className="h-4 w-4" />
                    Удалить
                  </button>
                )}
              </div>

              {draft.id && (
                <section className="pt-2">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      История прогонов
                    </h3>
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => void loadRuns(draft.id as number)}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Обновить
                    </button>
                  </div>

                  {runs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Прогонов ещё не было.</p>
                  ) : (
                    <div className="space-y-1">
                      {runs.map((run) => (
                        <button
                          key={run.id}
                          className={`flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2 text-left text-sm hover:bg-accent ${
                            openRun?.run.id === run.id ? 'bg-accent' : ''
                          }`}
                          onClick={() => void loadRun(run.id)}
                        >
                          <StatusBadge status={run.status} />
                          <span className="text-xs text-muted-foreground">{formatMoment(run.startedAt)}</span>
                          <span className="ml-auto text-xs text-muted-foreground">#{run.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {openRun && (
                <section className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Прогон #{openRun.run.id}</h3>
                    <StatusBadge status={openRun.run.status} />
                    {ACTIVE_STATUSES.has(openRun.run.status) && (
                      <button
                        className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-red-500 hover:bg-accent"
                        onClick={() => void cancelRun(openRun.run.id)}
                      >
                        <Square className="h-3 w-3" />
                        Остановить
                      </button>
                    )}
                  </div>

                  {openRun.run.error && <p className="mb-2 text-xs text-red-500">{openRun.run.error}</p>}

                  <div className="space-y-1">
                    {openRun.steps.map((step) => (
                      <div
                        key={step.stepIndex}
                        className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5"
                      >
                        <span className="text-xs text-muted-foreground">{step.stepIndex}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{step.name}</span>
                        <StatusBadge status={step.status} />
                        <button
                          className="rounded-md p-1 hover:bg-accent disabled:opacity-30"
                          disabled={step.status === 'pending' || step.status === 'skipped'}
                          onClick={() => void showStepOutput(openRun.run.id, step)}
                          aria-label="Показать вывод"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {openRun.run.artifactsDir && (
                    <p className="mt-2 break-all text-xs text-muted-foreground">
                      Артефакты: {openRun.run.artifactsDir}
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Portalled for the same reason as PanelModal: a bare `fixed` box would be
          trapped by the sidebar's containing block. */}
      {stepOutput && (
        <Dialog open onOpenChange={(open) => !open && setStepOutput(null)}>
          <DialogContent className="flex h-[min(80dvh,44rem)] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground">
            <DialogTitle>{stepOutput.title}</DialogTitle>
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-4 py-3">
              <button className="rounded-md p-1 hover:bg-accent" onClick={() => setStepOutput(null)} aria-label="Назад">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h3 className="truncate text-sm font-semibold">{stepOutput.title}</h3>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs text-foreground">
              {stepOutput.text}
            </pre>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

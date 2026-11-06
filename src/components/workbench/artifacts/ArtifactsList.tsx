import React, { useCallback, useEffect, useState } from 'react';
import { FileText, FileWarning, Image as ImageIcon, Loader2, Presentation, RefreshCw } from 'lucide-react';

import { isJevReportPath, type ArtifactKind, type ArtifactListItem } from '../../../../shared/artifacts';
import type { WorkbenchRenderContext } from '../workbenchTabs';

import { artifactsApi } from './artifactsApi';
import { useArtifactsChanged } from './useArtifactsChanged';

const KIND_LABELS: Record<ArtifactKind, string> = {
  html: 'Страница', slides: 'Слайды', markdown: 'Документ', pdf: 'PDF', image: 'Картинка', other: 'Файл',
};

function KindIcon({ kind }: { kind: ArtifactKind }) {
  const className = 'h-4 w-4 flex-shrink-0 text-muted-foreground';
  if (kind === 'image') return <ImageIcon className={className} aria-hidden />;
  if (kind === 'slides') return <Presentation className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}

/** «Результаты»: artifacts of the project, newest first; a file of the project can be opened by path. */
export default function ArtifactsList({ context }: { context: WorkbenchRenderContext }) {
  const projectId = context.project.projectId;
  const [items, setItems] = useState<ArtifactListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await artifactsApi.list(projectId));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить результаты');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  // New pages of the agent and new versions show up by themselves.
  useArtifactsChanged(projectId, () => { void load(); });

  const open = (item: { id: string; title: string }) => context.openTab({ kind: 'artifact', ref: item.id, title: item.title });

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    const filePath = pathInput.trim();
    if (!filePath) return;
    try {
      const result = await artifactsApi.publish(projectId, { path: filePath, sessionId: context.sessionId });
      setPathInput('');
      setPublishError(null);
      open(result.artifact);
      void load();
    } catch (publishFailure) {
      setPublishError(publishFailure instanceof Error ? publishFailure.message : 'Не удалось открыть файл');
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4" data-workbench-artifacts>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Результаты проекта</h3>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />Обновить
        </button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">{error}</p>}
      {!items && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Загружаем…</p>}
      {items && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Пока нет результатов. Агент публикует их сам, а у ссылки на файл в ответе есть кнопка «Открыть в холсте».
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open(item)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent">
                {item.file.exists ? <KindIcon kind={item.kind} /> : <FileWarning className="h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                    <span className="text-xs text-muted-foreground">{isJevReportPath(item.path) ? 'Отчёт Jev' : KIND_LABELS[item.kind]} · версия {item.latestVersion}</span>
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{item.path}</span>
                  {(!item.file.exists || item.openComments > 0) && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {!item.file.exists && 'Файл удалён или недоступен'}
                      {!item.file.exists && item.openComments > 0 && ' · '}
                      {item.openComments > 0 && `Открытых комментариев: ${item.openComments}`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={publish} className="space-y-1.5">
        <label htmlFor="artifact-path" className="text-xs text-muted-foreground">Открыть файл проекта в холсте</label>
        <div className="flex gap-2">
          <input
            id="artifact-path"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder="scripts/visual-qa/out/report.html"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground"
          />
          <button type="submit" disabled={!pathInput.trim()} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50">Открыть</button>
        </div>
        {publishError && <p role="alert" className="text-xs text-foreground">{publishError}</p>}
      </form>
    </div>
  );
}

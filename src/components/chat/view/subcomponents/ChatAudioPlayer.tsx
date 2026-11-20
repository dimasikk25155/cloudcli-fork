import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Save } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import { fileDownloadUrl } from '../../../../utils/fileDownload';
import { getPreviewMimeType } from '../../../code-editor/utils/previewableFile';

// Плеер прямо в ответе агента: голосовые и озвучку слушают в чате, а не
// «нажать → окно → скачать → открыть». Байты грузятся только по кнопке ▶ —
// десяток аудио в длинном чате не должен качаться при каждой отрисовке.
// Сервер файлы отдаёт без Range, поэтому, как и окно просмотра, кладём их в
// blob: так перемотка работает и в WebKit.
//
// Вся разметка — <span>: путь стоит внутри абзаца или пункта списка, а <div>
// внутри <p> браузер выносит наружу и ломает строку.

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'error'; message: string };

type ChatAudioPlayerProps = {
  filePath: string;
  projectId: string | undefined;
};

const fileNameOf = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

export default function ChatAudioPlayer({ filePath, projectId }: ChatAudioPlayerProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const name = fileNameOf(filePath);

  // Другой файл в том же месте разметки — начинаем с чистого листа.
  useEffect(() => {
    setState({ kind: 'idle' });
    return () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [filePath, projectId]);

  if (!projectId) return null;

  const load = async () => {
    if (state.kind === 'loading') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: 'loading' });
    try {
      const response = await authenticatedFetch(
        `/api/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(filePath)}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(response.status === 404 ? 'Файл не найден на сервере' : `Сервер ответил ${response.status}`);
      }
      const blob = await response.blob();
      const fallback = getPreviewMimeType(name);
      const generic = !blob.type || blob.type === 'application/octet-stream';
      const typed = generic && fallback ? new Blob([blob], { type: fallback }) : blob;
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(typed);
      urlRef.current = url;
      setState({ kind: 'ready', url });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Не удалось загрузить' });
    }
  };

  return (
    <span
      data-chat-audio
      className="not-prose my-2 flex w-full max-w-md flex-col gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2 font-sans"
    >
      <span className="flex items-center gap-2">
        {state.kind !== 'ready' && (
          <button
            type="button"
            onClick={() => void load()}
            disabled={state.kind === 'loading'}
            aria-label={`Слушать ${name}`}
            title="Слушать"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {state.kind === 'loading'
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <Play className="ml-0.5 h-4 w-4" aria-hidden />}
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={filePath}>{name}</span>
        <a
          href={fileDownloadUrl(projectId, filePath)}
          download={name}
          title="Скачать"
          aria-label={`Скачать ${name}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Save className="h-4 w-4" aria-hidden />
        </a>
      </span>
      {state.kind === 'ready' && (
        <audio
          src={state.url}
          controls
          autoPlay
          className="h-9 w-full"
          onError={() => setState({ kind: 'error', message: 'Браузер не проигрывает этот формат — скачай файл' })}
        />
      )}
      {state.kind === 'error' && <span className="text-xs text-red-500">{state.message}</span>}
    </span>
  );
}

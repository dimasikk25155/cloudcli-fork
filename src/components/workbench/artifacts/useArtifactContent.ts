import { useEffect, useState } from 'react';

import type { ArtifactKind, ArtifactVersion } from '../../../../shared/artifacts';

import { artifactsApi } from './artifactsApi';

export type ArtifactContent = { loading: boolean; error: string | null; text: string | null; url: string | null };

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
};

const looksLikePdf = async (blob: Blob) => new TextDecoder('latin1').decode(await blob.slice(0, 1024).arrayBuffer()).includes('%PDF-');

/**
 * Bytes of one version: its saved snapshot, or — for the latest version of a
 * file too big to be saved — the current project file. Text kinds give text,
 * images and PDF give a blob URL (PDF checked by its magic bytes and pinned to
 * application/pdf, as the editor preview does).
 */
export function useArtifactContent(input: {
  projectId: string;
  artifactId: string;
  kind: ArtifactKind;
  path: string;
  version: ArtifactVersion | null;
  /** The live file may stand in when the version has no snapshot. */
  liveFilePath: string | null;
  asText: boolean;
  enabled: boolean;
}): ArtifactContent {
  const { projectId, artifactId, kind, path, version, liveFilePath, asText, enabled } = input;
  const [state, setState] = useState<ArtifactContent>({ loading: false, error: null, text: null, url: null });
  const n = version?.n ?? 0;
  const hasSnapshot = Boolean(version?.snapshotFile);

  useEffect(() => {
    if (!enabled || !version) {
      setState({ loading: false, error: null, text: null, url: null });
      return undefined;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState({ loading: true, error: null, text: null, url: null });
    (async () => {
      try {
        let blob: Blob;
        if (hasSnapshot) blob = await artifactsApi.versionBlob(projectId, artifactId, n, controller.signal);
        else if (liveFilePath) blob = await artifactsApi.fileBlob(projectId, liveFilePath, controller.signal);
        else throw new Error('Файл был больше лимита: содержимое этой версии не сохранено');
        if (asText) {
          const text = await blob.text();
          if (!controller.signal.aborted) setState({ loading: false, error: null, text, url: null });
          return;
        }
        let type = blob.type;
        if (kind === 'pdf') {
          if (!(await looksLikePdf(blob))) throw new Error('Файл не похож на PDF');
          type = 'application/pdf';
        } else {
          const ext = path.split('.').pop()?.toLowerCase() ?? '';
          type = IMAGE_TYPES[ext] ?? type;
        }
        objectUrl = URL.createObjectURL(new Blob([blob], { type }));
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setState({ loading: false, error: null, text: null, url: objectUrl });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ loading: false, error: error instanceof Error ? error.message : 'Не удалось открыть версию', text: null, url: null });
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `version` identity changes on every refresh; the content only depends on n and the snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, artifactId, n, hasSnapshot, liveFilePath, asText, kind, path]);

  return state;
}

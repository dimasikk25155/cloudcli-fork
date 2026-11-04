import type {
  ArtifactAnchor,
  ArtifactComment,
  ArtifactCommentStatus,
  ArtifactDetail,
  ArtifactListItem,
  ArtifactSendResult,
} from '../../../../shared/artifacts';
import { authenticatedFetch } from '../../../utils/api';

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/artifacts`;

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string | { message?: string } };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    if (message) return message;
  } catch {
    // not JSON
  }
  return response.status === 409 ? 'Мод «Рабочий стол» выключен' : `Neo3 отказал (${response.status})`;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(url, init);
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.json() as { data: T };
  return body.data;
}

const post = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });

export const artifactsApi = {
  list: (projectId: string) => call<ArtifactListItem[]>(base(projectId)),
  publish: (projectId: string, input: { path: string; title?: string; sessionId?: string | null; messageId?: string | null }) => (
    call<ArtifactDetail & { changed: boolean; created: boolean }>(base(projectId), post(input))
  ),
  detail: (projectId: string, id: string) => call<ArtifactDetail>(`${base(projectId)}/${encodeURIComponent(id)}`),
  refresh: (projectId: string, id: string) => call<ArtifactDetail & { changed: boolean }>(`${base(projectId)}/${encodeURIComponent(id)}/refresh`, post({})),
  restore: (projectId: string, id: string, n: number) => call<ArtifactDetail>(`${base(projectId)}/${encodeURIComponent(id)}/versions/${n}/restore`, post({})),
  addComment: (projectId: string, id: string, input: { anchor: ArtifactAnchor; text: string; versionN: number }) => (
    call<ArtifactComment>(`${base(projectId)}/${encodeURIComponent(id)}/comments`, post(input))
  ),
  updateComment: (projectId: string, id: string, commentId: string, patch: { status?: ArtifactCommentStatus; text?: string }) => (
    call<ArtifactComment>(`${base(projectId)}/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, post(patch, 'PATCH'))
  ),
  sendComments: (projectId: string, id: string, sessionId: string) => (
    call<ArtifactSendResult>(`${base(projectId)}/${encodeURIComponent(id)}/send-comments`, post({ sessionId }))
  ),
  /** Bytes of a saved version (HTML comes as text). */
  async versionBlob(projectId: string, id: string, n: number, signal?: AbortSignal): Promise<Blob> {
    const response = await authenticatedFetch(`${base(projectId)}/${encodeURIComponent(id)}/versions/${n}/content`, { signal });
    if (!response.ok) throw new Error(await readError(response));
    return response.blob();
  },
  /** Bytes of the current project file (for a version too big to be saved). */
  async fileBlob(projectId: string, filePath: string, signal?: AbortSignal): Promise<Blob> {
    const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(filePath)}`, { signal });
    if (!response.ok) throw new Error('Файл недоступен');
    return response.blob();
  },
};

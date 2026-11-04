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

/** A refusal of the artifacts API: the server's `code` and `details` stay readable (409 ARTIFACT_EDIT_CONFLICT → `details.latestVersion`). */
export class ArtifactsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly details: unknown) {
    super(message);
    this.name = 'ArtifactsApiError';
  }
}

async function readFailure(response: Response): Promise<ArtifactsApiError> {
  let message: string | undefined;
  let code: string | null = null;
  let details: unknown = null;
  try {
    // The app's error middleware (`apiErrorHandler`): `{success:false, error:{code, message, details}}`.
    const body = await response.json() as { error?: string | { message?: string; code?: string; details?: unknown } };
    const error = typeof body.error === 'object' && body.error !== null ? body.error : null;
    message = typeof body.error === 'string' ? body.error : error?.message;
    code = typeof error?.code === 'string' ? error.code : null;
    details = error?.details ?? null;
  } catch {
    // not JSON
  }
  const fallback = response.status === 409 ? 'Мод «Рабочий стол» выключен' : `Neo3 отказал (${response.status})`;
  return new ArtifactsApiError(message || fallback, response.status, code, details);
}

async function readError(response: Response): Promise<string> {
  return (await readFailure(response)).message;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(url, init);
  if (!response.ok) throw await readFailure(response);
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
  /**
   * «Сохранить» of the «Правка» mode: a new version `edit`. The file changed
   * since `baseVersionN` → ArtifactsApiError 409 `ARTIFACT_EDIT_CONFLICT`, `details.latestVersion`.
   */
  saveEdit: (projectId: string, id: string, input: { content: string; baseVersionN: number }) => (
    call<ArtifactDetail>(`${base(projectId)}/${encodeURIComponent(id)}/edit`, post(input, 'PUT'))
  ),
  /** URL of the editor's copy (parsed source + bridge) served by file preview at the file's own path. */
  async editorPreview(projectId: string, id: string, html: string): Promise<string> {
    const { url } = await call<{ url: string }>(`${base(projectId)}/${encodeURIComponent(id)}/editor-preview`, post({ html }));
    return url;
  },
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

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ASSET_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.mp3', '.wav', '.ogg']);
const inside = (root: string, file: string) => file.startsWith(`${root}${path.sep}`);
const safeRelative = (relative: string) => !relative.split(/[\\/]/).some((part) => part.startsWith('.') || /^(?:secrets?|credentials?)(?:[.-]|$)/i.test(part));

export class PreviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** «Копия документа»: the page itself comes from memory, the rest of the grant from disk. */
type GrantDocument = { relPath: string; html: string };
type Grant = { root: string; expiresAt: number; userId: number; projectId: string; document?: GrantDocument };
const MAX_GRANTS = 500;
const MAX_DOCUMENT_GRANTS = 20;
const DOCUMENT_PATH = /\.(?:html?|svg)$/i;
/** Request path → `/`-separated relative path; null — not a plain relative path. */
const normalizeRelative = (relative: string): string | null => {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative)) return null;
  const normalized = path.posix.normalize(relative.split(path.sep).join('/'));
  return normalized.startsWith('../') || normalized === '..' || normalized === '.' ? null : normalized;
};
export function createFilePreviewService({ now = Date.now, ttlMs = 30 * 60_000, canAccess = (_userId: number, _projectId: string): boolean => true } = {}) {
  const grants = new Map<string, Grant>();
  const prune = () => { for (const [token, grant] of grants) if (grant.expiresAt <= now()) grants.delete(token); };
  const issueToken = (grant: Grant) => {
    prune();
    if (grants.size >= MAX_GRANTS) grants.delete(grants.keys().next().value!);
    const token = randomBytes(24).toString('hex');
    grants.set(token, grant);
    return token;
  };
  const liveGrant = (token: string) => {
    prune();
    const grant = grants.get(token);
    return grant && canAccess(grant.userId, grant.projectId) ? grant : null;
  };
  return {
    /**
     * A grant whose page (`relPath`, a real path relative to the real `root`)
     * is the given HTML kept in memory — the editor's copy of a document with
     * its bridge; every other path of the grant is served from disk as usual.
     * At most 20 such grants: the oldest is dropped.
     */
    createDocumentGrant({ root, relPath, html, userId, projectId, ttlMs: documentTtlMs }: { root: string; relPath: string; html: string; userId: number; projectId: string; ttlMs?: number }) {
      const relative = normalizeRelative(relPath);
      if (!relative || !safeRelative(relative) || !DOCUMENT_PATH.test(relative)) throw new PreviewError(403, 'Этот файл нельзя открыть как страницу');
      const documentTokens = [...grants].filter(([, grant]) => grant.document).map(([token]) => token);
      for (const token of documentTokens.slice(0, Math.max(0, documentTokens.length - MAX_DOCUMENT_GRANTS + 1))) grants.delete(token);
      const token = issueToken({ root, expiresAt: now() + (documentTtlMs ?? ttlMs), userId, projectId, document: { relPath: relative, html } });
      return { token, url: `/api/file-preview/${token}/${relative.split('/').map(encodeURIComponent).join('/')}` };
    },
    /** HTML of a document grant at its own path; null — not a document of a live grant. */
    document(token: string, relative: string): string | null {
      const grant = liveGrant(token);
      if (!grant?.document) return null;
      return normalizeRelative(relative) === grant.document.relPath ? grant.document.html : null;
    },
    async issue({ file, projectRoot, projectId, userId, admin }: { file: string; projectRoot: string; projectId: string; userId: number; admin: boolean }) {
      if (!canAccess(userId, projectId)) throw new PreviewError(403, 'Нет доступа к проекту');
      const [resolved, project] = await Promise.all([fs.realpath(file), fs.realpath(projectRoot)]);
      if (!inside(project, resolved) && !admin) throw new PreviewError(403, 'Файл вне проекта');
      const root = inside(project, resolved) ? project : path.dirname(resolved);
      // An external directory becomes the grant root, so its own private path components
      // must be checked before they disappear from the relative asset path.
      if (!inside(project, resolved) && !safeRelative(root)) throw new PreviewError(403, 'Ресурс недоступен');
      const relative = path.relative(root, resolved);
      if (!safeRelative(relative) || !/\.html?$/i.test(resolved)) throw new PreviewError(403, 'Этот файл нельзя открыть как страницу');
      if (!(await fs.stat(resolved)).isFile()) throw new PreviewError(404, 'Файл не найден');
      const expiresAt = now() + ttlMs;
      const token = issueToken({ root, expiresAt, userId, projectId });
      return { url: `/api/file-preview/${token}/${relative.split(path.sep).map(encodeURIComponent).join('/')}`, expiresAt };
    },
    async resource(token: string, relative: string) {
      const grant = liveGrant(token);
      if (!grant) throw new PreviewError(403, 'Превью истекло. Откройте файл заново');
      if (!relative || !safeRelative(relative) || relative.includes('\0') || path.isAbsolute(relative)) throw new PreviewError(403, 'Ресурс недоступен');
      const candidate = path.resolve(grant.root, relative);
      if (!inside(grant.root, candidate)) throw new PreviewError(403, 'Ресурс вне папки превью');
      const resolved = await fs.realpath(candidate);
      if (!inside(grant.root, resolved) || !safeRelative(path.relative(grant.root, resolved)) || !ASSET_EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw new PreviewError(403, 'Ресурс недоступен');
      if (!(await fs.stat(resolved)).isFile()) throw new PreviewError(404, 'Файл не найден');
      return resolved;
    },
  };
}

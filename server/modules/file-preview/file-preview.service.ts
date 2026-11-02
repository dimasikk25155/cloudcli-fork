import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ASSET_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.mp3', '.wav', '.ogg']);
const inside = (root: string, file: string) => file.startsWith(`${root}${path.sep}`);
const safeRelative = (relative: string) => !relative.split(/[\\/]/).some((part) => part.startsWith('.') || /^(?:secrets?|credentials?)(?:[.-]|$)/i.test(part));

export class PreviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Grant = { root: string; expiresAt: number; userId: number; projectId: string };
export function createFilePreviewService({ now = Date.now, ttlMs = 30 * 60_000, canAccess = (_userId: number, _projectId: string): boolean => true } = {}) {
  const grants = new Map<string, Grant>();
  const prune = () => { for (const [token, grant] of grants) if (grant.expiresAt <= now()) grants.delete(token); };
  return {
    async issue({ file, projectRoot, projectId, userId, admin }: { file: string; projectRoot: string; projectId: string; userId: number; admin: boolean }) {
      if (!canAccess(userId, projectId)) throw new PreviewError(403, 'Нет доступа к проекту');
      const [resolved, project] = await Promise.all([fs.realpath(file), fs.realpath(projectRoot)]);
      if (!inside(project, resolved) && !admin) throw new PreviewError(403, 'Файл вне проекта');
      const root = inside(project, resolved) ? project : path.dirname(resolved);
      const relative = path.relative(root, resolved);
      if (!safeRelative(relative) || !/\.html?$/i.test(resolved)) throw new PreviewError(403, 'Этот файл нельзя открыть как страницу');
      if (!(await fs.stat(resolved)).isFile()) throw new PreviewError(404, 'Файл не найден');
      prune();
      if (grants.size >= 500) grants.delete(grants.keys().next().value!);
      const token = randomBytes(24).toString('hex');
      const expiresAt = now() + ttlMs;
      grants.set(token, { root, expiresAt, userId, projectId });
      return { url: `/api/file-preview/${token}/${relative.split(path.sep).map(encodeURIComponent).join('/')}`, expiresAt };
    },
    async resource(token: string, relative: string) {
      prune();
      const grant = grants.get(token);
      if (!grant || !canAccess(grant.userId, grant.projectId)) throw new PreviewError(403, 'Превью истекло. Откройте файл заново');
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

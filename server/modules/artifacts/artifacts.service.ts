import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isModOn as defaultIsModOn, modOffError, type IsModOn } from '@/shared/mods.js';
import { AppError } from '@/shared/utils.js';

import type { WorkspaceRecord } from '../../../shared/agent-workspace.js';
import {
  ARTIFACT_BINARY_LIMIT_BYTES,
  ARTIFACT_TEXT_LIMIT_BYTES,
  artifactKindForPath,
  buildArtifactCommentsMessage,
  isTextArtifactPath,
  type Artifact,
  type ArtifactAnchor,
  type ArtifactComment,
  type ArtifactCommentPayload,
  type ArtifactCommentStatus,
  type ArtifactDetail,
  type ArtifactFileState,
  type ArtifactListItem,
  type ArtifactPayload,
  type ArtifactRecordView,
  type ArtifactSendResult,
  type ArtifactVersion,
  type ArtifactVersionPayload,
  type ArtifactVersionSource,
} from '../../../shared/artifacts.js';
import type { WorkspaceStore } from '../agent-workspace/index.js';

export const ARTIFACT_KIND = 'artifact';
export const ARTIFACT_VERSION_KIND = 'artifact-version';
export const ARTIFACT_COMMENT_KIND = 'artifact-comment';

const MAX_COMMENT_CHARS = 4000;
const MAX_QUOTE_CHARS = 2000;
const MAX_TITLE_CHARS = 200;

/** The part of node:fs/promises the service uses (a seam for tests). */
export type ArtifactsFs = Pick<typeof nodeFs, 'realpath' | 'stat' | 'readFile' | 'writeFile' | 'mkdir' | 'open'>;

export type ArtifactsDependencies = {
  store: WorkspaceStore;
  /** Root folder of a project; null — no such project. */
  projectPath(projectId: string): string | null;
  canAccessProject(userId: number, projectId: string): boolean;
  /** Project of a chat the user may open; null — no access or no project. */
  sessionProjectId?(userId: number, sessionId: string): string | null;
  isModOn?: IsModOn;
  fs?: ArtifactsFs;
  /** Folder of snapshots; default `~/.cloudcli/artifacts` (read on every use: tests swap HOME). */
  snapshotRoot?: () => string;
  now?: () => string;
  limits?: { text: number; binary: number };
  /**
   * File preview «копия документа» (`filePreviewService.createDocumentGrant`):
   * the editor's copy of a page served at the real path of the file.
   */
  documentGrant?: (input: { root: string; relPath: string; html: string; userId: number; projectId: string }) => { token: string; url: string };
  /**
   * An artifact got a new version (published, changed, restored, edited).
   * Production sends the content-free `artifacts_changed` frame to the project.
   */
  onChanged?: (event: { projectId: string; artifactId: string }) => void;
};

export type SaveEditInput = { content: unknown; baseVersionN: unknown };
export type EditorPreviewInput = { html: unknown };

export type PublishInput = { path: unknown; title?: unknown; sessionId?: unknown; messageId?: unknown };
export type CommentInput = { anchor: unknown; text: unknown; versionN?: unknown };
export type CommentPatch = { status?: unknown; text?: unknown };

function fail(message: string, code: string, statusCode: number): never {
  throw new AppError(message, { code, statusCode });
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Path segments never published: env files, secrets, VCS and key folders. */
const PRIVATE_SEGMENT = /^(?:\.env(?:\..*)?|\.secrets?(?:[.-].*)?|\.git|\.ssh|\.gnupg|(?:secrets?|credentials?)(?:[.-].*)?)$/i;

const toPosix = (value: string) => value.split(path.sep).join('/');

const PRIVATE_PATH_CODE = 'ARTIFACT_PATH_PRIVATE';

function failPrivate(): never {
  fail('Этот файл нельзя открыть в холсте', PRIVATE_PATH_CODE, 400);
}

/** A real path (symlinks resolved) relative to the real project root goes through a private segment. */
function isPrivateRealPath(realRoot: string, realPath: string): boolean {
  return path.relative(realRoot, realPath).split(path.sep).some((segment) => PRIVATE_SEGMENT.test(segment));
}

const isPrivatePathError = (error: unknown) => error instanceof AppError && error.code === PRIVATE_PATH_CODE;

/** The file at the checked path was replaced (a link, another file) between the check and the write. */
function failSwapped(): never {
  fail('Файл подменили во время записи — ничего не записано. Открой артефакт заново', 'ARTIFACT_FILE_SWAPPED', 400);
}

/** Errors of opening a path that changed under us: a link (O_NOFOLLOW), a missing file or folder. */
const SWAP_ERRNO: ReadonlySet<string> = new Set(['ELOOP', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EEXIST', 'EMLINK']);

/** A path segment the file preview never serves: a dot folder (`.autopilot`, `.claude`, …). */
const HIDDEN_SEGMENT = /^\./;

/** Documents the «Правка» mode edits: HTML pages, slides and SVG pictures. */
const EDITABLE_PATH = /\.(?:html?|svg)$/i;
const EDITABLE_KINDS: ReadonlySet<string> = new Set(['html', 'slides', 'image']);

const view = <T>(record: WorkspaceRecord<T>): ArtifactRecordView<T> => ({
  ...record.payload,
  id: record.id,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  ownerUserId: record.ownerUserId,
});

const optionalString = (value: unknown, max = 200): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const fraction = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
);

function readAnchor(value: unknown): ArtifactAnchor {
  const anchor = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (anchor.type === 'rect') {
    const [x, y, w, h] = [fraction(anchor.x), fraction(anchor.y), fraction(anchor.w), fraction(anchor.h)];
    const EPS = 1e-6;
    if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0 || x + w > 1 + EPS || y + h > 1 + EPS) {
      fail('Область комментария задаётся долями 0..1 внутри страницы', 'ARTIFACT_ANCHOR_INVALID', 400);
    }
    return { type: 'rect', x, y, w, h };
  }
  if (anchor.type === 'quote') {
    const text = typeof anchor.text === 'string' ? anchor.text.trim() : '';
    if (!text) fail('Цитата комментария пустая', 'ARTIFACT_ANCHOR_INVALID', 400);
    return { type: 'quote', text: text.slice(0, MAX_QUOTE_CHARS) };
  }
  fail('Комментарий должен указывать область или цитату', 'ARTIFACT_ANCHOR_INVALID', 400);
}

/**
 * Artifacts of a project: publication, versions (a snapshot on publication
 * and on every change of the file), restore, comments to a region or a quote
 * and the message with them for the source chat.
 *
 * Paths follow the relay-file rule: relative paths are taken from the project
 * root, any `..` is refused, the check runs on real paths (a symlink inside the
 * project pointing outside is refused), env files and secrets are never read.
 * Every call re-checks the mod switch and the project access.
 */
export function createArtifactsService(deps: ArtifactsDependencies) {
  const fs = deps.fs ?? nodeFs;
  const now = deps.now ?? (() => new Date().toISOString());
  const isModOn = deps.isModOn ?? defaultIsModOn;
  const snapshotRoot = deps.snapshotRoot ?? (() => path.join(os.homedir(), '.cloudcli', 'artifacts'));
  const limits = deps.limits ?? { text: ARTIFACT_TEXT_LIMIT_BYTES, binary: ARTIFACT_BINARY_LIMIT_BYTES };
  const { store } = deps;

  function guard(userId: number, projectId: string): string {
    if (!isModOn(userId, 'modWorkbench')) throw modOffError('modWorkbench');
    const root = deps.projectPath(projectId);
    if (!root) fail('Проект не найден', 'PROJECT_NOT_FOUND', 404);
    if (!deps.canAccessProject(userId, projectId)) fail('Нет доступа к проекту', 'PROJECT_ACCESS_DENIED', 403);
    return root;
  }

  function checkSession(userId: number, projectId: string, sessionId: string): void {
    const sessionProject = deps.sessionProjectId?.(userId, sessionId) ?? null;
    if (sessionProject !== projectId) fail('Чат недоступен или из другого проекта', 'ARTIFACT_SESSION_DENIED', 403);
  }

  function getArtifact(projectId: string, id: string): WorkspaceRecord<ArtifactPayload> {
    const record = id ? store.get<ArtifactPayload>(id) : undefined;
    if (!record || record.kind !== ARTIFACT_KIND || record.projectId !== projectId) {
      fail('Артефакт не найден', 'ARTIFACT_NOT_FOUND', 404);
    }
    return record;
  }

  const versionsOf = (projectId: string, artifactId: string) => store
    .list<ArtifactVersionPayload>(ARTIFACT_VERSION_KIND, { projectId })
    .filter((record) => record.payload.artifactId === artifactId)
    .sort((a, b) => a.payload.n - b.payload.n);

  const commentsOf = (projectId: string, artifactId: string) => store
    .list<ArtifactCommentPayload>(ARTIFACT_COMMENT_KIND, { projectId })
    .filter((record) => record.payload.artifactId === artifactId)
    .sort((a, b) => (a.payload.n ?? 0) - (b.payload.n ?? 0));

  /** Requested path → absolute path inside the project (the file may be missing). */
  async function resolvePath(projectRoot: string, requested: unknown): Promise<{ absPath: string; relPath: string; exists: boolean }> {
    const raw = typeof requested === 'string' ? requested.trim() : '';
    if (!raw || raw.includes('\0')) fail('Не указан путь к файлу', 'ARTIFACT_PATH_INVALID', 400);
    const segments = raw.split(/[\\/]+/);
    if (segments.includes('..')) fail('Путь к файлу не должен содержать «..»', 'ARTIFACT_PATH_INVALID', 400);
    if (segments.some((segment) => PRIVATE_SEGMENT.test(segment))) failPrivate();

    const lexicalRoot = path.resolve(projectRoot);
    let realRoot: string;
    try {
      realRoot = await fs.realpath(lexicalRoot);
    } catch {
      fail('Папка проекта не найдена', 'PROJECT_NOT_FOUND', 404);
    }
    const candidate = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(lexicalRoot, raw);
    const base = isInside(lexicalRoot, candidate) ? lexicalRoot : isInside(realRoot, candidate) ? realRoot : null;
    if (!base) fail('Файл лежит вне проекта', 'ARTIFACT_PATH_OUTSIDE_PROJECT', 400);
    const relPath = toPosix(path.relative(base, candidate));
    if (!relPath) fail('Нужен файл, а не папка проекта', 'ARTIFACT_PATH_INVALID', 400);
    const absPath = path.join(lexicalRoot, relPath);

    let realCandidate: string;
    try {
      realCandidate = await fs.realpath(absPath);
    } catch {
      // A missing file: its folder still must not resolve into a private one (restore writes there).
      const realParent = await fs.realpath(path.dirname(absPath)).catch(() => null);
      if (realParent && isInside(realRoot, realParent) && isPrivateRealPath(realRoot, realParent)) failPrivate();
      return { absPath, relPath, exists: false };
    }
    if (!isInside(realRoot, realCandidate)) fail('Файл лежит вне проекта', 'ARTIFACT_PATH_OUTSIDE_PROJECT', 400);
    // The requested name may be harmless while a link inside the project points at .env/.git/...
    if (isPrivateRealPath(realRoot, realCandidate)) failPrivate();
    const info = await fs.stat(realCandidate);
    if (!info.isFile()) fail('Это не файл', 'ARTIFACT_PATH_INVALID', 400);
    return { absPath, relPath, exists: true };
  }

  /** Current file state; a path that became unsafe (symlink swapped outside) counts as missing. */
  async function fileState(projectRoot: string, relPath: string): Promise<ArtifactFileState> {
    try {
      const resolved = await resolvePath(projectRoot, relPath);
      return { exists: resolved.exists, absPath: resolved.absPath };
    } catch {
      return { exists: false, absPath: path.join(path.resolve(projectRoot), relPath) };
    }
  }

  /** Reads the file and its fingerprint; over the limit — metadata only. */
  async function readCurrent(projectRoot: string, absPath: string): Promise<{ sha256: string; size: number; data: Buffer | null }> {
    const real = await fs.realpath(absPath);
    // Re-checked on the path actually read: the link could be swapped after resolvePath.
    const realRoot = await fs.realpath(path.resolve(projectRoot));
    if (!isInside(realRoot, real)) fail('Файл лежит вне проекта', 'ARTIFACT_PATH_OUTSIDE_PROJECT', 400);
    if (isPrivateRealPath(realRoot, real)) failPrivate();
    const info = await fs.stat(real);
    const limit = isTextArtifactPath(absPath) ? limits.text : limits.binary;
    if (info.size > limit) {
      return { sha256: `meta:${info.size}:${Math.round(info.mtimeMs)}`, size: info.size, data: null };
    }
    const data = await fs.readFile(real);
    return { sha256: createHash('sha256').update(data).digest('hex'), size: data.length, data };
  }

  const snapshotPath = (artifactId: string, file: string) => path.join(snapshotRoot(), artifactId, file);

  async function addVersion(
    userId: number,
    projectId: string,
    artifact: WorkspaceRecord<ArtifactPayload>,
    current: { sha256: string; size: number; data: Buffer | null },
    source: ArtifactVersionSource,
    extra: { snapshotFile?: string | null; restoredFrom?: number } = {},
  ): Promise<WorkspaceRecord<ArtifactPayload>> {
    const n = artifact.payload.latestVersion + 1;
    let snapshotFile = extra.snapshotFile ?? null;
    if (current.data && extra.snapshotFile === undefined) {
      snapshotFile = `v${n}${path.extname(artifact.payload.path).toLowerCase()}`;
      await fs.mkdir(path.dirname(snapshotPath(artifact.id, snapshotFile)), { recursive: true });
      await fs.writeFile(snapshotPath(artifact.id, snapshotFile), current.data);
    }
    const updated = store.transaction(() => {
      const next = store.update<ArtifactPayload>(artifact.id, artifact.revision, { ...artifact.payload, latestVersion: n });
      store.create<ArtifactVersionPayload>({
        kind: ARTIFACT_VERSION_KIND,
        ownerUserId: userId,
        projectId,
        payload: {
          artifactId: artifact.id,
          n,
          sha256: current.sha256,
          size: current.size,
          snapshotFile,
          createdAt: now(),
          source,
          ...(extra.restoredFrom !== undefined ? { restoredFrom: extra.restoredFrom } : {}),
        },
      });
      return next;
    });
    try {
      deps.onChanged?.({ projectId, artifactId: artifact.id });
    } catch {
      // A missed notice only delays the list; the version is saved.
    }
    return updated;
  }

  async function detailOf(projectRoot: string, projectId: string, artifact: WorkspaceRecord<ArtifactPayload>): Promise<ArtifactDetail> {
    return {
      artifact: view(artifact) as Artifact,
      versions: versionsOf(projectId, artifact.id).map((record) => view(record) as ArtifactVersion),
      comments: commentsOf(projectId, artifact.id).map((record) => view(record) as ArtifactComment),
      file: await fileState(projectRoot, artifact.payload.path),
    };
  }

  /** New version when the file changed since the latest one. */
  async function snapshotIfChanged(userId: number, projectId: string, projectRoot: string, artifact: WorkspaceRecord<ArtifactPayload>) {
    let state: { absPath: string; exists: boolean };
    try {
      state = await resolvePath(projectRoot, artifact.payload.path);
    } catch (error) {
      // A file that became a link to a private one is refused, never snapshotted; other unsafe paths count as missing.
      if (isPrivatePathError(error)) throw error;
      return { artifact, changed: false };
    }
    if (!state.exists) return { artifact, changed: false };
    const current = await readCurrent(projectRoot, state.absPath);
    const latest = versionsOf(projectId, artifact.id).at(-1);
    if (latest && latest.payload.sha256 === current.sha256) return { artifact, changed: false };
    const updated = await addVersion(userId, projectId, artifact, current, latest ? 'change' : 'publish');
    return { artifact: updated, changed: true };
  }

  /** Mod, artifact, kind and size of the sent text: shared by saving and the editor's copy. */
  function editableArtifact(userId: number, projectId: string, id: string, text: unknown): { artifact: WorkspaceRecord<ArtifactPayload>; data: Buffer } {
    if (!isModOn(userId, 'modArtifactEditor')) throw modOffError('modArtifactEditor');
    const artifact = getArtifact(projectId, id);
    if (!EDITABLE_KINDS.has(artifact.payload.kind) || !EDITABLE_PATH.test(artifact.payload.path)) {
      fail('Править вручную можно только HTML, слайды и SVG', 'ARTIFACT_EDIT_UNSUPPORTED', 400);
    }
    if (typeof text !== 'string') fail('Нет текста документа', 'ARTIFACT_EDIT_INVALID', 400);
    const data = Buffer.from(text, 'utf8');
    if (data.length > limits.text) fail('Документ больше лимита текстового файла', 'ARTIFACT_EDIT_TOO_LARGE', 413);
    return { artifact, data };
  }

  /**
   * Real path of the artifact's file, checked right now: inside the real project
   * root, not through a private segment, still a page (a link swapped onto
   * package.json is not one). Called again immediately before the write.
   */
  async function verifiedRealPath(projectRoot: string, absPath: string, page = true): Promise<{ real: string; realRoot: string }> {
    const real = await fs.realpath(absPath);
    const realRoot = await fs.realpath(path.resolve(projectRoot));
    if (!isInside(realRoot, real)) fail('Файл лежит вне проекта', 'ARTIFACT_PATH_OUTSIDE_PROJECT', 400);
    if (isPrivateRealPath(realRoot, real)) failPrivate();
    if (page && !EDITABLE_PATH.test(real)) fail('Ссылка ведёт не на страницу', 'ARTIFACT_EDIT_UNSUPPORTED', 400);
    return { real, realRoot };
  }

  /**
   * Writes over the checked file: opened without following a link and without
   * truncation, the opened file must be the one `stat` saw at the checked real
   * path (same device and inode) — only then truncate and write. Any mismatch
   * is a 400 and nothing is written.
   */
  async function writeOverChecked(real: string, data: Buffer): Promise<void> {
    const checked = await fs.stat(real);
    if (!checked.isFile()) failSwapped();
    let handle: Awaited<ReturnType<ArtifactsFs['open']>>;
    try {
      handle = await fs.open(real, fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if (SWAP_ERRNO.has((error as NodeJS.ErrnoException)?.code ?? '')) failSwapped();
      throw error;
    }
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== checked.dev || opened.ino !== checked.ino) failSwapped();
      await handle.truncate(0);
      await handle.write(data, 0, data.length, 0);
    } finally {
      await handle.close();
    }
  }

  /** A deleted file written back: a new file (never a link) in its checked real folder. */
  async function writeNewChecked(realParent: string, name: string, data: Buffer): Promise<void> {
    let handle: Awaited<ReturnType<ArtifactsFs['open']>>;
    try {
      handle = await fs.open(path.join(realParent, name), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o644);
    } catch (error) {
      if (SWAP_ERRNO.has((error as NodeJS.ErrnoException)?.code ?? '')) failSwapped();
      throw error;
    }
    try {
      await handle.write(data, 0, data.length, 0);
    } finally {
      await handle.close();
    }
  }

  /**
   * One version-making action of an artifact at a time (save, restore, refresh,
   * publication): two saves from the same version cannot both pass the check.
   */
  const queues = new Map<string, Promise<unknown>>();
  function serialized<T>(artifactId: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(artifactId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.then(() => undefined, () => undefined);
    queues.set(artifactId, tail);
    void tail.then(() => {
      if (queues.get(artifactId) === tail) queues.delete(artifactId);
    });
    return run;
  }

  async function existingFile(projectRoot: string, artifact: WorkspaceRecord<ArtifactPayload>) {
    const resolved = await resolvePath(projectRoot, artifact.payload.path);
    if (!resolved.exists) fail(`Файл не найден: ${resolved.relPath}`, 'ARTIFACT_FILE_NOT_FOUND', 404);
    return resolved;
  }

  async function restoreNow(userId: number, projectId: string, root: string, id: string, n: number): Promise<ArtifactDetail> {
    const artifact = getArtifact(projectId, id);
    const version = versionsOf(projectId, artifact.id).find((record) => record.payload.n === n);
    if (!version) fail('Версия не найдена', 'ARTIFACT_VERSION_NOT_FOUND', 404);
    if (!version.payload.snapshotFile) {
      fail('Эту версию нельзя восстановить: её содержимое не сохранено (файл был слишком большим)', 'ARTIFACT_SNAPSHOT_MISSING', 409);
    }
    const data = await fs.readFile(snapshotPath(artifact.id, version.payload.snapshotFile));
    // The same path rule as publication; a deleted file is written back only into an existing folder inside the project.
    const resolved = await resolvePath(root, artifact.payload.path);
    if (resolved.exists) {
      const { real } = await verifiedRealPath(root, resolved.absPath, false);
      await writeOverChecked(real, data);
    } else {
      let parent: string;
      try {
        parent = await fs.realpath(path.dirname(resolved.absPath));
      } catch {
        fail('Папки файла больше нет', 'ARTIFACT_FILE_NOT_FOUND', 404);
      }
      const realRoot = await fs.realpath(path.resolve(root));
      if (!isInside(realRoot, parent)) fail('Файл лежит вне проекта', 'ARTIFACT_PATH_OUTSIDE_PROJECT', 400);
      if (isPrivateRealPath(realRoot, parent)) failPrivate();
      await writeNewChecked(parent, path.basename(resolved.absPath), data);
    }
    const updated = await addVersion(userId, projectId, artifact, { sha256: version.payload.sha256, size: data.length, data }, 'restore', {
      snapshotFile: version.payload.snapshotFile,
      restoredFrom: version.payload.n,
    });
    return detailOf(root, projectId, updated);
  }

  async function saveEditNow(userId: number, projectId: string, root: string, id: string, input: SaveEditInput): Promise<ArtifactDetail> {
    // Read again inside the queue: the previous save may have moved the latest version on.
    const { artifact, data } = editableArtifact(userId, projectId, id, input.content);
    const baseVersionN = Number(input.baseVersionN);
    if (!Number.isSafeInteger(baseVersionN) || baseVersionN < 1) fail('Не указана версия, с которой начата правка', 'ARTIFACT_EDIT_INVALID', 400);
    const resolved = await existingFile(root, artifact);
    await verifiedRealPath(root, resolved.absPath);
    const current = await readCurrent(root, resolved.absPath);
    const base = versionsOf(projectId, artifact.id).find((record) => record.payload.n === baseVersionN);
    if (!base || baseVersionN !== artifact.payload.latestVersion || base.payload.sha256 !== current.sha256) {
      const latest = (await snapshotIfChanged(userId, projectId, root, artifact)).artifact.payload.latestVersion;
      throw new AppError('Файл изменился, пока ты правил', { code: 'ARTIFACT_EDIT_CONFLICT', statusCode: 409, details: { latestVersion: latest } });
    }
    // The link could be swapped while the content was compared: the write goes to the path checked right now,
    // and only into the very file checked there (no link followed, same inode).
    const { real } = await verifiedRealPath(root, resolved.absPath);
    await writeOverChecked(real, data);
    const updated = await addVersion(userId, projectId, artifact, {
      sha256: createHash('sha256').update(data).digest('hex'),
      size: data.length,
      data,
    }, 'edit');
    return detailOf(root, projectId, updated);
  }

  return {
    async list(userId: number, projectId: string): Promise<ArtifactListItem[]> {
      const root = guard(userId, projectId);
      const comments = store.list<ArtifactCommentPayload>(ARTIFACT_COMMENT_KIND, { projectId });
      const artifacts = store.list<ArtifactPayload>(ARTIFACT_KIND, { projectId });
      const items = await Promise.all(artifacts.map(async (record) => ({
        ...(view(record) as Artifact),
        file: await fileState(root, record.payload.path),
        openComments: comments.filter((c) => c.payload.artifactId === record.id && c.payload.status === 'open').length,
      })));
      return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async publish(userId: number, projectId: string, input: PublishInput): Promise<ArtifactDetail & { changed: boolean; created: boolean }> {
      const root = guard(userId, projectId);
      const sessionId = optionalString(input.sessionId);
      if (sessionId) checkSession(userId, projectId, sessionId);
      const resolved = await resolvePath(root, input.path);
      if (!resolved.exists) fail(`Файл не найден: ${resolved.relPath}`, 'ARTIFACT_FILE_NOT_FOUND', 404);
      const title = optionalString(input.title, MAX_TITLE_CHARS);
      const messageId = optionalString(input.messageId);

      const existing = store.list<ArtifactPayload>(ARTIFACT_KIND, { projectId })
        .find((record) => record.payload.path === resolved.relPath);
      let artifact = existing ?? store.create<ArtifactPayload>({
        kind: ARTIFACT_KIND,
        ownerUserId: userId,
        projectId,
        payload: {
          path: resolved.relPath,
          title: title ?? path.basename(resolved.relPath),
          kind: artifactKindForPath(resolved.relPath),
          sessionId,
          messageId,
          latestVersion: 0,
        },
      });
      if (existing && ((title && title !== existing.payload.title) || (!existing.payload.sessionId && sessionId))) {
        artifact = store.update<ArtifactPayload>(existing.id, existing.revision, {
          ...existing.payload,
          title: title ?? existing.payload.title,
          sessionId: existing.payload.sessionId ?? sessionId,
          messageId: existing.payload.sessionId ? existing.payload.messageId : messageId,
        });
      }
      const published = artifact;
      const result = await serialized(published.id, () => snapshotIfChanged(userId, projectId, root, store.get<ArtifactPayload>(published.id) ?? published));
      return { ...(await detailOf(root, projectId, result.artifact)), changed: result.changed, created: !existing };
    },

    async detail(userId: number, projectId: string, id: string): Promise<ArtifactDetail> {
      const root = guard(userId, projectId);
      return detailOf(root, projectId, getArtifact(projectId, id));
    },

    async refresh(userId: number, projectId: string, id: string): Promise<ArtifactDetail & { changed: boolean }> {
      const root = guard(userId, projectId);
      getArtifact(projectId, id);
      const result = await serialized(id, () => snapshotIfChanged(userId, projectId, root, getArtifact(projectId, id)));
      return { ...(await detailOf(root, projectId, result.artifact)), changed: result.changed };
    },

    async versionContent(userId: number, projectId: string, id: string, n: number): Promise<{ data: Buffer; fileName: string; version: ArtifactVersion }> {
      guard(userId, projectId);
      const artifact = getArtifact(projectId, id);
      const version = versionsOf(projectId, artifact.id).find((record) => record.payload.n === n);
      if (!version) fail('Версия не найдена', 'ARTIFACT_VERSION_NOT_FOUND', 404);
      if (!version.payload.snapshotFile) {
        fail('Файл был слишком большим: содержимое этой версии не сохранено', 'ARTIFACT_SNAPSHOT_MISSING', 409);
      }
      let data: Buffer;
      try {
        data = await fs.readFile(snapshotPath(artifact.id, version.payload.snapshotFile));
      } catch {
        fail('Снимок этой версии не найден на диске', 'ARTIFACT_SNAPSHOT_MISSING', 409);
      }
      return { data, fileName: path.basename(artifact.payload.path), version: view(version) as ArtifactVersion };
    },

    async restore(userId: number, projectId: string, id: string, n: number): Promise<ArtifactDetail> {
      const root = guard(userId, projectId);
      getArtifact(projectId, id);
      return serialized(id, () => restoreNow(userId, projectId, root, id, n));
    },

    /**
     * «Сохранить» of the «Правка» mode: writes the edited document over the file
     * and adds a version `edit`. Refused with 409 ARTIFACT_EDIT_CONFLICT (details
     * `{latestVersion}`) when the edit did not start from the latest version or
     * the file on disk no longer matches that version (the agent changed it) —
     * the agent's change becomes a version, the file is not touched. Saves of one
     * artifact run one after another: of two saves from the same version the
     * second gets the conflict.
     */
    async saveEdit(userId: number, projectId: string, id: string, input: SaveEditInput): Promise<ArtifactDetail> {
      const root = guard(userId, projectId);
      editableArtifact(userId, projectId, id, input.content);
      return serialized(id, () => saveEditNow(userId, projectId, root, id, input));
    },

    /**
     * The editor's copy of the document (the parsed source with `data-neo3-id`
     * and the bridge) served by file preview at the real path of the file:
     * relative pictures and CSS load from disk, the page under the preview CSP.
     */
    async editorPreview(userId: number, projectId: string, id: string, input: EditorPreviewInput): Promise<{ url: string }> {
      const root = guard(userId, projectId);
      const { artifact } = editableArtifact(userId, projectId, id, input.html);
      const resolved = await existingFile(root, artifact);
      const { real, realRoot } = await verifiedRealPath(root, resolved.absPath);
      if (!deps.documentGrant) fail('Превью правки недоступно', 'ARTIFACT_EDIT_PREVIEW_UNAVAILABLE', 503);
      const relPath = toPosix(path.relative(realRoot, real));
      // The file preview serves nothing from dot folders (.git, .env, …): the page could not load there.
      if (relPath.split('/').some((segment) => HIDDEN_SEGMENT.test(segment))) {
        fail('Править вручную нельзя файл из скрытой папки (имя начинается с точки). Скопируй его в обычную папку проекта или попроси агента', 'ARTIFACT_EDIT_HIDDEN_FOLDER', 400);
      }
      let grant: { url: string };
      try {
        grant = deps.documentGrant({ root: realRoot, relPath, html: input.html as string, userId, projectId });
      } catch (error) {
        // The preview's own refusal (PreviewError {status, message}) stays a refusal, not a 500.
        const status = (error as { status?: unknown })?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) {
          fail(error instanceof Error && error.message ? error.message : 'Эту страницу нельзя показать в правке', 'ARTIFACT_EDIT_PREVIEW_DENIED', status);
        }
        throw error;
      }
      return { url: grant.url };
    },

    addComment(userId: number, projectId: string, id: string, input: CommentInput): ArtifactComment {
      guard(userId, projectId);
      const artifact = getArtifact(projectId, id);
      const anchor = readAnchor(input.anchor);
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) fail('Напишите комментарий', 'ARTIFACT_COMMENT_EMPTY', 400);
      const requested = Number(input.versionN);
      const versionN = Number.isSafeInteger(requested) && requested >= 1 && requested <= artifact.payload.latestVersion
        ? requested
        : artifact.payload.latestVersion;
      const n = commentsOf(projectId, artifact.id).reduce((max, comment) => Math.max(max, comment.payload.n ?? 0), 0) + 1;
      const record = store.create<ArtifactCommentPayload>({
        kind: ARTIFACT_COMMENT_KIND,
        ownerUserId: userId,
        projectId,
        payload: { artifactId: artifact.id, n, versionN, anchor, text: text.slice(0, MAX_COMMENT_CHARS), status: 'open', sentAt: null, sentToSessionId: null },
      });
      return view(record) as ArtifactComment;
    },

    updateComment(userId: number, projectId: string, id: string, commentId: string, patch: CommentPatch): ArtifactComment {
      guard(userId, projectId);
      const artifact = getArtifact(projectId, id);
      const record = store.get<ArtifactCommentPayload>(commentId);
      if (!record || record.kind !== ARTIFACT_COMMENT_KIND || record.projectId !== projectId || record.payload.artifactId !== artifact.id) {
        fail('Комментарий не найден', 'ARTIFACT_COMMENT_NOT_FOUND', 404);
      }
      const next: ArtifactCommentPayload = { ...record.payload };
      if (patch.status !== undefined) {
        if (patch.status !== 'open' && patch.status !== 'resolved' && patch.status !== 'sent') {
          fail('Неизвестный статус комментария', 'ARTIFACT_COMMENT_INVALID', 400);
        }
        next.status = patch.status as ArtifactCommentStatus;
      }
      if (patch.text !== undefined) {
        const text = typeof patch.text === 'string' ? patch.text.trim() : '';
        if (!text) fail('Напишите комментарий', 'ARTIFACT_COMMENT_EMPTY', 400);
        next.text = text.slice(0, MAX_COMMENT_CHARS);
      }
      return view(store.update(record.id, record.revision, next)) as ArtifactComment;
    },

    /**
     * Builds the message for the chat (the source chat by default) from the open
     * comments (or the listed ones) and marks them «sent». Delivery is the
     * caller's: the client sends the text through the chat's own composer.
     */
    sendComments(userId: number, projectId: string, id: string, input: { sessionId?: unknown; commentIds?: unknown }): ArtifactSendResult {
      const root = guard(userId, projectId);
      const artifact = getArtifact(projectId, id);
      const sessionId = optionalString(input.sessionId) ?? artifact.payload.sessionId;
      if (!sessionId) fail('У артефакта нет исходного чата: откройте его из чата', 'ARTIFACT_SESSION_REQUIRED', 400);
      checkSession(userId, projectId, sessionId);
      const wanted = Array.isArray(input.commentIds) ? new Set(input.commentIds.filter((v): v is string => typeof v === 'string')) : null;
      const comments = commentsOf(projectId, artifact.id)
        .filter((record) => (wanted ? wanted.has(record.id) && record.payload.status !== 'resolved' : record.payload.status === 'open'));
      if (comments.length === 0) fail('Нет открытых комментариев для отправки', 'ARTIFACT_NO_COMMENTS', 400);
      const text = buildArtifactCommentsMessage({
        absPath: path.join(path.resolve(root), artifact.payload.path),
        title: artifact.payload.title,
        latestVersion: artifact.payload.latestVersion,
        comments: comments.map((record) => record.payload),
      });
      const sentAt = now();
      store.transaction(() => {
        for (const record of comments) {
          store.update(record.id, record.revision, { ...record.payload, status: 'sent', sentAt, sentToSessionId: sessionId });
        }
      });
      return { sessionId, text, commentIds: comments.map((record) => record.id) };
    },
  };
}

export type ArtifactsService = ReturnType<typeof createArtifactsService>;

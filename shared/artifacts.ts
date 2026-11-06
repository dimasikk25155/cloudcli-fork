/**
 * Артефакты рабочего стола — общий контракт сервера и клиента.
 *
 * Артефакт — файл проекта (HTML-инфографика, слайды, Markdown, PDF, картинка),
 * опубликованный в холст: агентом (`workspace_action` `artifact.publish`) или
 * человеком (кнопка «Открыть в холсте» у ссылки на файл). Хранение —
 * `workspace_records` трёх kind: `artifact`, `artifact-version`,
 * `artifact-comment`; снимки содержимого — `~/.cloudcli/artifacts/<id>/`.
 */

export const ARTIFACT_KINDS = ['html', 'markdown', 'pdf', 'image', 'slides', 'other'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** `edit` — saved from the «Правка» mode of the canvas (mod «Правка артефактов»). */
export const ARTIFACT_VERSION_SOURCES = ['publish', 'change', 'restore', 'edit'] as const;
export type ArtifactVersionSource = (typeof ARTIFACT_VERSION_SOURCES)[number];

export const ARTIFACT_COMMENT_STATUSES = ['open', 'sent', 'resolved'] as const;
export type ArtifactCommentStatus = (typeof ARTIFACT_COMMENT_STATUSES)[number];

/** Snapshot limits: bigger files keep only metadata (size, time), no content. */
export const ARTIFACT_TEXT_LIMIT_BYTES = 2 * 1024 * 1024;
export const ARTIFACT_BINARY_LIMIT_BYTES = 20 * 1024 * 1024;

export type ArtifactPayload = {
  /** Path relative to the project root, `/`-separated. */
  path: string;
  title: string;
  kind: ArtifactKind;
  /** Source chat (app session id) and message, when known. */
  sessionId: string | null;
  messageId: string | null;
  latestVersion: number;
};

export type ArtifactVersionPayload = {
  artifactId: string;
  n: number;
  /** sha256 of the content; for a file over the limit — `meta:<size>:<mtimeMs>`. */
  sha256: string;
  size: number;
  /** Snapshot file name inside the artifact folder; null — over the limit, metadata only. */
  snapshotFile: string | null;
  createdAt: string;
  source: ArtifactVersionSource;
  /** Version restored by a `restore` version. */
  restoredFrom?: number;
};

export type ArtifactAnchor =
  | { type: 'rect'; x: number; y: number; w: number; h: number /* доли 0..1 */ }
  | { type: 'quote'; text: string };

export type ArtifactCommentPayload = {
  artifactId: string;
  /** Order of the comment within the artifact, 1, 2, … (records of one millisecond keep it). */
  n: number;
  versionN: number;
  anchor: ArtifactAnchor;
  text: string;
  status: ArtifactCommentStatus;
  sentAt?: string | null;
  sentToSessionId?: string | null;
};

export type ArtifactRecordView<T> = { id: string; revision: number; createdAt: string; updatedAt: string; ownerUserId: number } & T;

export type Artifact = ArtifactRecordView<ArtifactPayload>;
export type ArtifactVersion = ArtifactRecordView<ArtifactVersionPayload>;
export type ArtifactComment = ArtifactRecordView<ArtifactCommentPayload>;

/** State of the file behind the artifact right now. */
export type ArtifactFileState = {
  /** false — deleted or no longer reachable inside the project. */
  exists: boolean;
  /** Absolute path (as resolved against the project root). */
  absPath: string;
};

export type ArtifactDetail = {
  artifact: Artifact;
  versions: ArtifactVersion[];
  comments: ArtifactComment[];
  file: ArtifactFileState;
};

/** `GET /api/projects/:projectId/artifacts` item. */
export type ArtifactListItem = Artifact & { file: ArtifactFileState; openComments: number };

/** `POST /:id/send-comments` result: the message for the source chat. */
export type ArtifactSendResult = {
  sessionId: string;
  text: string;
  commentIds: string[];
};

const HTML_RE = /\.html?$/i;
const MARKDOWN_RE = /\.(md|markdown)$/i;
const PDF_RE = /\.pdf$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const SLIDES_RE = /(^|[\\/._-])(slides?|deck|presentation|слайд[а-я]*|презентаци[а-я]*)([\\/._-]|$)/i;

/** Kind of an artifact by its file name. */
export function artifactKindForPath(filePath: string): ArtifactKind {
  if (HTML_RE.test(filePath)) return SLIDES_RE.test(filePath) ? 'slides' : 'html';
  if (MARKDOWN_RE.test(filePath)) return 'markdown';
  if (PDF_RE.test(filePath)) return 'pdf';
  if (IMAGE_RE.test(filePath)) return 'image';
  return 'other';
}

/** Files with an «Открыть в холсте» button in chat answers. */
export function isCanvasFile(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  const clean = filePath.trim().replace(/:\d+(?::\d+)?$/, '');
  return /\.(html?|md|markdown|pdf|png|jpe?g|gif|webp|svg)$/i.test(clean);
}

/** Text content (2 MB limit) vs binary (20 MB). SVG is text. */
export function isTextArtifactPath(filePath: string): boolean {
  return !/\.(pdf|png|jpe?g|gif|webp|avif)$/i.test(filePath);
}

/** Jev visual QA report (`scripts/visual-qa/…/report.html`). */
export function isJevReportPath(filePath: string): boolean {
  return /(^|\/)visual-qa\/(.+\/)?report\.html?$/i.test(filePath.replace(/\\/g, '/'));
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** One line of the «Отправить агенту» message. */
export function describeArtifactAnchor(anchor: ArtifactAnchor): string {
  if (anchor.type === 'quote') {
    const quote = anchor.text.replace(/\s+/g, ' ').trim();
    return `цитата: «${quote.length > 300 ? `${quote.slice(0, 300)}…` : quote}»`;
  }
  return `область: слева ${pct(anchor.x)}, сверху ${pct(anchor.y)}, ширина ${pct(anchor.w)}, высота ${pct(anchor.h)}`;
}

/**
 * The message the source chat receives: the file path, the version the
 * comments were made on and the numbered list of comments.
 */
export function buildArtifactCommentsMessage(input: {
  absPath: string;
  title: string;
  latestVersion: number;
  comments: Array<Pick<ArtifactCommentPayload, 'anchor' | 'text' | 'versionN'>>;
}): string {
  const lines = [
    `Комментарии к файлу \`${input.absPath}\` (артефакт «${input.title}», текущая версия ${input.latestVersion}):`,
    '',
    ...input.comments.map((comment, index) => (
      `${index + 1}. [${describeArtifactAnchor(comment.anchor)}; версия ${comment.versionN}] ${comment.text.trim()}`
    )),
    '',
    'Поправь файл по этим комментариям и коротко напиши, что изменил. Области даны в долях кадра просмотра от его левого верхнего угла.',
  ];
  return lines.join('\n');
}

// Tools that change files, by engine, and where each keeps the path.
const CLAUDE_FILE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const GROK_FILE_TOOLS: ReadonlySet<string> = new Set(['search_replace', 'write', 'write_file', 'edit_file', 'create_file']);
/** Codex `file_change` item, normalized by the Codex provider. */
export const CODEX_FILE_TOOL = 'FileChanges';

function parseToolInput(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

const pathOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

function codexChangePaths(input: unknown): string[] {
  // History: `{changes: [{kind, path, moveTo?}], patch}`; live stream: the array itself.
  const changes = Array.isArray(input) ? input : (input as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) return [];
  const paths: string[] = [];
  for (const change of changes) {
    if (!change || typeof change !== 'object') continue;
    const entry = change as Record<string, unknown>;
    for (const candidate of [entry.path, entry.moveTo, entry.move_path]) {
      const found = pathOf(candidate);
      if (found) paths.push(found);
    }
  }
  return paths;
}

/**
 * Files one tool call changes: Claude (Edit/Write/MultiEdit/NotebookEdit),
 * Codex (FileChanges, history and live shapes) and Grok (search_replace/write…).
 * Other tools — none. Shared by the inspector and the server's auto-publish.
 */
export function toolChangedPaths(toolName: string | null | undefined, toolInput: unknown): string[] {
  if (!toolName) return [];
  const input = parseToolInput(toolInput);
  if (toolName === CODEX_FILE_TOOL) return codexChangePaths(input);
  if (!CLAUDE_FILE_TOOLS.has(toolName) && !GROK_FILE_TOOLS.has(toolName)) return [];
  if (!input || typeof input !== 'object') return [];
  const fields = input as Record<string, unknown>;
  const found = pathOf(fields.file_path) ?? pathOf(fields.notebook_path) ?? pathOf(fields.path) ?? pathOf(fields.target_file);
  return found ? [found] : [];
}

/** Build output and dependencies: generated, never a result of the chat. */
const AUTO_SKIP_SEGMENT = /^(?:node_modules|dist|dist-server|build|out|coverage|vendor|bower_components)$/i;

/**
 * A file the agent wrote that goes to «Результаты» by itself: an HTML page
 * (slides included) or an SVG picture — what the canvas shows and «Правка»
 * edits. The path is relative to the project root; not inside dot folders
 * (`.autopilot`, `.claude`, … — the file preview never serves them) nor
 * build/dependency folders.
 */
export function isAutoArtifactPath(relPath: string | null | undefined): boolean {
  if (!relPath) return false;
  const clean = relPath.trim().replace(/\\/g, '/');
  if (!/\.(?:html?|svg)$/i.test(clean)) return false;
  const folders = clean.split('/').slice(0, -1);
  return !folders.some((segment) => segment.startsWith('.') || AUTO_SKIP_SEGMENT.test(segment));
}

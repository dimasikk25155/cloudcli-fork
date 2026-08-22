import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Shared image-attachment plumbing for every provider runtime.
 *
 * Uploaded chat images are persisted once in the global `~/.cloudcli/assets`
 * folder and referenced by absolute path everywhere else:
 * - Claude: paths are read back into base64 `image` content blocks.
 * - Codex: paths become `local_image` input items.
 * - Cursor/OpenCode: paths are appended to the prompt inside an
 *   `<images_input>` tag, which is stripped again when history is read.
 *
 * The chat UI loads them through the dedicated `/api/assets/images/:filename`
 * route, which serves only from this folder.
 */

/** Global storage folder for uploaded chat image attachments. */
export function getGlobalImageAssetsDir(): string {
  return path.join(os.homedir(), '.cloudcli', 'assets');
}

export type ImageAttachmentDescriptor = {
  /** Project-relative (preferred) or absolute path to the stored image. */
  path: string;
  name?: string;
  mimeType?: string;
};

/** Media types the Claude Messages API accepts for base64 image blocks. */
const CLAUDE_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const EXTENSION_TO_MEDIA_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * Accepts the loosely-typed `options.images` payload from chat.send and
 * returns only well-formed descriptors. Plain path strings are supported so
 * callers can also pass bare path arrays.
 */
export function normalizeImageDescriptors(images: unknown): ImageAttachmentDescriptor[] {
  if (!Array.isArray(images)) {
    return [];
  }

  const descriptors: ImageAttachmentDescriptor[] = [];
  for (const entry of images) {
    if (typeof entry === 'string' && entry.trim()) {
      descriptors.push({ path: entry.trim() });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const entryPath = typeof record.path === 'string' ? record.path.trim() : '';
      if (!entryPath) {
        continue;
      }
      descriptors.push({
        path: entryPath,
        name: typeof record.name === 'string' ? record.name : undefined,
        mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
      });
    }
  }
  return descriptors;
}

/** Normalizes Windows separators so stored references stay portable. */
export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Resolves a project-relative image path against the run's working directory. */
export function resolveImageAbsolutePath(cwd: string | undefined, imagePath: string): string {
  if (path.isAbsolute(imagePath)) {
    return imagePath;
  }
  return path.resolve(cwd || process.cwd(), imagePath);
}

function isPathInsideDirectory(candidate: string, directory: string): boolean {
  // resolve + startsWith(root + separator) is the containment idiom CodeQL
  // recognizes as a path-injection barrier, and matches the check used by
  // resolveImageAssetFile in the assets module. The root itself never
  // matches (no trailing separator after resolve), only entries below it.
  const resolvedRoot = path.resolve(directory) + path.sep;
  return path.resolve(candidate).startsWith(resolvedRoot);
}

function getDirectoryPathVariants(directory: string): string[] {
  const resolvedDirectory = path.resolve(directory);
  try {
    const canonicalDirectory = path.resolve(realpathSync(directory));
    return canonicalDirectory === resolvedDirectory
      ? [resolvedDirectory]
      : [resolvedDirectory, canonicalDirectory];
  } catch {
    return [resolvedDirectory];
  }
}

/**
 * Second layer of the image trust boundary (the first is the chat.send filter
 * in the websocket gateway): provider builders only reference files that live
 * in the global upload store or inside the run's working directory — places
 * the agent could already access on its own. Anything else (e.g. `~/.ssh`) is
 * refused, so a caller-supplied descriptor can never leak arbitrary files.
 */
export function isAllowedImageSourcePath(resolvedPath: string, cwd?: string): boolean {
  return [getGlobalImageAssetsDir(), cwd || process.cwd()].some((directory) =>
    getDirectoryPathVariants(directory).some((directoryVariant) =>
      isPathInsideDirectory(resolvedPath, directoryVariant)
    )
  );
}

/**
 * Resolves the media type for one image, preferring the uploaded mime type and
 * falling back to the file extension.
 */
export function resolveImageMediaType(descriptor: ImageAttachmentDescriptor): string | null {
  if (descriptor.mimeType) {
    return descriptor.mimeType;
  }
  const extension = path.extname(descriptor.path).toLowerCase();
  return EXTENSION_TO_MEDIA_TYPE[extension] || null;
}

const IMAGES_INPUT_TAG_PATTERN = /\s*<images_input>([\s\S]*?)<\/images_input>\s*/g;

// One image reference recovered from an <images_input> block: the stored
// asset path plus the user's original filename when it was recorded.
export type ParsedImageAttachment = {
  path: string;
  name?: string;
};

// Result of stripping an <images_input> block out of persisted prompt text.
// `imagePaths` mirrors `attachments` for callers that only need paths.
export type ParsedImagesInput = {
  text: string;
  imagePaths: string[];
  attachments: ParsedImageAttachment[];
};

/**
 * Appends the `<images_input>` reference block used by the Cursor and
 * OpenCode CLIs. The block carries one numbered line per attachment with
 * the stored file path (quote-free on purpose — Windows .cmd shims mangle
 * quoted text) and the user's original filename, plus an explicit instruction
 * to read the files and keep the block out of the reply. The same block is
 * stripped back out of persisted history by {@link parseImagesInputTag}.
 */
/**
 * One numbered line per attachment: the stored path plus the user's original
 * filename. Shared by every reference block so they stay parseable by
 * {@link parseNumberedImageEntries}.
 */
function formatAttachmentLines(descriptors: ImageAttachmentDescriptor[]): string[] {
  return descriptors.map((descriptor, index) => {
    const entryPath = toPosixPath(descriptor.path);
    // Parentheses and newlines would break the "(original name: ...)" suffix
    // the parser looks for, so drop them from the display name.
    const cleanName = descriptor.name?.replace(/[()\r\n]/g, '').trim();
    return cleanName
      ? `${index + 1}. ${entryPath} (original name: ${cleanName})`
      : `${index + 1}. ${entryPath}`;
  });
}

export function appendImagesInputTag(prompt: string, images: unknown): string {
  const descriptors = normalizeImageDescriptors(images);
  if (descriptors.length === 0) {
    return prompt;
  }

  const entryLines = formatAttachmentLines(descriptors);

  return [
    prompt,
    '',
    '<images_input>',
    `The user attached ${descriptors.length} image(s) to this message. Read each file listed below with your file/image reading tool and use what you see to answer the prompt above. Respond as if the images were attached directly. Do not mention this block or the file paths unless the user asks about them.`,
    ...entryLines,
    '</images_input>',
  ].join('\n');
}

/**
 * Same `<images_input>` block, but for runtimes that already show the picture
 * to the model (Claude's base64 vision blocks, Codex's `local_image` items).
 * Without this the agent can see an attachment and still has no idea where it
 * lives, so it cannot hand the file to a tool — `vis --ref <file>`, ffmpeg, an
 * upload. The images stay in the global store; only their paths are named.
 *
 * Reuses the `<images_input>` tag on purpose: {@link parseImagesInputTag} and
 * {@link stripAttachmentReferenceTags} already keep it out of displayed history.
 */
export function appendVisibleImagePathsTag(prompt: string, images: unknown): string {
  const descriptors = normalizeImageDescriptors(images);
  if (descriptors.length === 0) {
    return prompt;
  }

  return [
    prompt,
    '',
    '<images_input>',
    `The user attached ${descriptors.length} image(s) to this message; you can already see them, so there is no need to read the files to know their contents. Each one is also saved on disk at the path listed below — use that path whenever a tool needs the file itself (image or video generation, ffmpeg, an upload). Do not mention this block or the file paths unless the user asks about them.`,
    ...formatAttachmentLines(descriptors),
    '</images_input>',
  ].join('\n');
}

// Matches one numbered attachment entry inside the tag body. Works for both
// the multi-line block and the Windows-flattened single-line form, where the
// next ` N. ` marker (or the end of the body) delimits each entry.
const IMAGES_INPUT_ENTRY_PATTERN = /\d+\.\s+(.+?)(?=\s+\d+\.\s+|\s*$)/g;

const ORIGINAL_NAME_SUFFIX_PATTERN = /\(original name: ([^)]*)\)\s*$/;

function parseNumberedImageEntries(inner: string): ParsedImageAttachment[] {
  const attachments: ParsedImageAttachment[] = [];
  for (const entryMatch of inner.matchAll(IMAGES_INPUT_ENTRY_PATTERN)) {
    let entryText = entryMatch[1].trim();
    let name: string | undefined;

    const nameMatch = ORIGINAL_NAME_SUFFIX_PATTERN.exec(entryText);
    if (nameMatch) {
      name = nameMatch[1].trim() || undefined;
      entryText = entryText.slice(0, nameMatch.index).trim();
    }

    if (entryText) {
      attachments.push(name ? { path: toPosixPath(entryText), name } : { path: toPosixPath(entryText) });
    }
  }
  return attachments;
}

/**
 * Strips one `<images_input>` block from persisted prompt text and returns
 * the clean text plus the referenced attachments (path and original name).
 *
 * Only the LAST block in the text is treated as the attachment carrier — the
 * composer always appends it at the end, so a user who literally typed
 * `<images_input>` earlier in their prompt keeps that text intact.
 *
 * Understands the numbered-line body in both its multi-line and
 * Windows-flattened single-line forms.
 */
export function parseImagesInputTag(text: string): ParsedImagesInput {
  if (typeof text !== 'string' || !text.includes('<images_input>')) {
    return { text, imagePaths: [], attachments: [] };
  }

  let lastMatch: RegExpExecArray | null = null;
  IMAGES_INPUT_TAG_PATTERN.lastIndex = 0;
  for (let match = IMAGES_INPUT_TAG_PATTERN.exec(text); match; match = IMAGES_INPUT_TAG_PATTERN.exec(text)) {
    lastMatch = match;
  }
  if (!lastMatch) {
    return { text, imagePaths: [], attachments: [] };
  }

  const attachments = parseNumberedImageEntries(lastMatch[1]);

  const stripped = (
    text.slice(0, lastMatch.index) + '\n' + text.slice(lastMatch.index + lastMatch[0].length)
  ).trim();

  return {
    text: stripped,
    imagePaths: attachments.map((attachment) => attachment.path),
    attachments,
  };
}

/** Maps raw image paths to the attachment shape carried by NormalizedMessage.images. */
export function toImageAttachments(imagePaths: string[]): Array<{ path: string }> {
  return imagePaths.map((imagePath) => ({ path: toPosixPath(imagePath) }));
}

/**
 * Whether a descriptor is a viewable image (the provider runtimes turn these
 * into vision blocks) as opposed to a generic file the agent must read off
 * disk. Prefers the stored mime type and falls back to the file extension.
 */
export function isImageDescriptor(descriptor: ImageAttachmentDescriptor): boolean {
  if (descriptor.mimeType) {
    return descriptor.mimeType.startsWith('image/');
  }
  return path.extname(descriptor.path).toLowerCase() in EXTENSION_TO_MEDIA_TYPE;
}

/**
 * Splits a mixed attachment list into images (handled per-provider as vision)
 * and other files (referenced by path in an `<attached_files>` block the agent
 * reads with its own tools). Both keep their original descriptor shape.
 */
export function splitAttachmentsByKind(attachments: unknown): {
  images: ImageAttachmentDescriptor[];
  files: ImageAttachmentDescriptor[];
} {
  const images: ImageAttachmentDescriptor[] = [];
  const files: ImageAttachmentDescriptor[] = [];
  for (const descriptor of normalizeImageDescriptors(attachments)) {
    (isImageDescriptor(descriptor) ? images : files).push(descriptor);
  }
  return { images, files };
}

const ATTACHED_FILES_TAG_PATTERN = /\s*<attached_files>([\s\S]*?)<\/attached_files>\s*/g;

// Result of stripping an <attached_files> block out of persisted prompt text.
export type ParsedAttachedFiles = {
  text: string;
  files: ParsedImageAttachment[];
};

/**
 * Appends the `<attached_files>` reference block for non-image attachments.
 * Mirrors {@link appendImagesInputTag} — one numbered line per file with the
 * stored path (quote-free for Windows .cmd shims) and original name — but tells
 * the agent to read the files with its own tools, since these are not images
 * the model can see directly. Stripped back out of history by
 * {@link parseAttachedFilesTag}.
 */
export function appendAttachedFilesTag(prompt: string, files: unknown): string {
  const descriptors = normalizeImageDescriptors(files);
  if (descriptors.length === 0) {
    return prompt;
  }

  const entryLines = descriptors.map((descriptor, index) => {
    const entryPath = toPosixPath(descriptor.path);
    const cleanName = descriptor.name?.replace(/[()\r\n]/g, '').trim();
    return cleanName
      ? `${index + 1}. ${entryPath} (original name: ${cleanName})`
      : `${index + 1}. ${entryPath}`;
  });

  return [
    prompt,
    '',
    '<attached_files>',
    `The user attached ${descriptors.length} file(s) to this message. Read each file listed below with your file-reading tool (or an appropriate shell command for archives/binaries) and use its contents to answer the prompt above. Do not mention this block or the file paths unless the user asks about them.`,
    ...entryLines,
    '</attached_files>',
  ].join('\n');
}

/**
 * Strips the last `<attached_files>` block from persisted prompt text and
 * returns the clean text plus the referenced files. Symmetric with
 * {@link parseImagesInputTag}; only the last block is treated as the carrier so
 * a user who literally typed the tag earlier keeps that text intact.
 */
export function parseAttachedFilesTag(text: string): ParsedAttachedFiles {
  if (typeof text !== 'string' || !text.includes('<attached_files>')) {
    return { text, files: [] };
  }

  let lastMatch: RegExpExecArray | null = null;
  ATTACHED_FILES_TAG_PATTERN.lastIndex = 0;
  for (let match = ATTACHED_FILES_TAG_PATTERN.exec(text); match; match = ATTACHED_FILES_TAG_PATTERN.exec(text)) {
    lastMatch = match;
  }
  if (!lastMatch) {
    return { text, files: [] };
  }

  const files = parseNumberedImageEntries(lastMatch[1]);
  const stripped = (
    text.slice(0, lastMatch.index) + '\n' + text.slice(lastMatch.index + lastMatch[0].length)
  ).trim();

  return { text: stripped, files };
}

/**
 * Removes both attachment reference blocks (`<images_input>` and
 * `<attached_files>`) from persisted prompt text for display. Providers that
 * only need clean text — not the parsed attachments — use this.
 */
export function stripAttachmentReferenceTags(text: string): string {
  return parseAttachedFilesTag(parseImagesInputTag(text).text).text;
}

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

/**
 * Builds the Claude user-message content list: the prompt text followed by one
 * base64 `image` block per attachment. Images the Claude API cannot accept
 * (e.g. SVG) or that fail to read are skipped with a warning so the prompt
 * itself still goes through.
 */
export async function buildClaudeUserContent(
  prompt: string,
  images: unknown,
  cwd?: string,
): Promise<ClaudeContentBlock[]> {
  const blocks: ClaudeContentBlock[] = [{ type: 'text', text: prompt }];

  for (const descriptor of normalizeImageDescriptors(images)) {
    const mediaType = resolveImageMediaType(descriptor);
    if (!mediaType || !CLAUDE_IMAGE_MEDIA_TYPES.has(mediaType)) {
      console.warn(`[Images] Skipping unsupported Claude image type for ${descriptor.path}`);
      continue;
    }

    const resolvedPath = resolveImageAbsolutePath(cwd, descriptor.path);
    if (!isAllowedImageSourcePath(resolvedPath, cwd)) {
      console.warn(`[Images] Refusing to read image outside allowed roots: ${descriptor.path}`);
      continue;
    }

    try {
      const canonicalPath = await fs.realpath(resolvedPath);
      if (!isAllowedImageSourcePath(canonicalPath, cwd)) {
        console.warn(`[Images] Refusing to read symlinked image outside allowed roots: ${descriptor.path}`);
        continue;
      }

      const bytes = await fs.readFile(canonicalPath);
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: bytes.toString('base64'),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Images] Failed to read image ${descriptor.path}: ${message}`);
    }
  }

  return blocks;
}

type CodexInputItem =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };

/**
 * Builds the Codex `runStreamed` input list: prompt text plus one
 * `local_image` item per attachment, resolved to absolute paths so the Codex
 * runtime can read them regardless of its own working directory handling.
 */
export function buildCodexInputItems(prompt: string, images: unknown, cwd?: string): CodexInputItem[] {
  const items: CodexInputItem[] = [{ type: 'text', text: prompt }];
  for (const descriptor of normalizeImageDescriptors(images)) {
    const resolvedPath = resolveImageAbsolutePath(cwd, descriptor.path);
    if (!isAllowedImageSourcePath(resolvedPath, cwd)) {
      // Same trust boundary as buildClaudeUserContent — the Codex runtime
      // reads this file, so it must stay within the allowed roots.
      console.warn(`[Images] Refusing to attach image outside allowed roots: ${descriptor.path}`);
      continue;
    }
    items.push({
      type: 'local_image',
      path: resolvedPath,
    });
  }
  return items;
}

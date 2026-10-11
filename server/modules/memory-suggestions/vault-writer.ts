/**
 * Writing an accepted note into the vault (spec story 48).
 *
 * Two hard rules, enforced here independently of what the note parser
 * already checked:
 *   - the file lands strictly inside the vault root — `..`, absolute folders
 *     and symlinks pointing out (at any depth) are refused, and no folder is
 *     created before its existing parent was resolved inside the vault;
 *   - nothing is ever overwritten: a taken name gets `-2`, `-3`, … and the
 *     file is opened with O_EXCL, so even a race cannot clobber a note.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SLUG_MAX = 80;
const SUFFIX_LIMIT = 100;
/** Top-level vault folders that are not projects. */
const NON_PROJECT_FOLDERS = new Set(['wiki', 'brand', 'tools', 'raw', 'clippings', 'tasks', 'node_modules']);

export class VaultPathError extends Error {}

/** `NEO3_VAULT_DIR`, by default `~/Antigravity Project/Dimasik-Obsidian/Dimasik` (decision 12). */
export function vaultDir(): string {
  const configured = process.env.NEO3_VAULT_DIR?.trim();
  return configured || path.join(os.homedir(), 'Antigravity Project', 'Dimasik-Obsidian', 'Dimasik');
}

/** Lowercase kebab-case file name from a title; Cyrillic is kept. */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return slug || 'note';
}

/** Top-level project folders of the vault (`<Проект>/` targets). Missing vault → none. */
export async function listProjectFolders(root: string = vaultDir()): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !NON_PROJECT_FOLDERS.has(entry.name.toLowerCase()))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export type WriteVaultNoteInput = {
  vaultDir: string;
  /** Vault-relative folder, e.g. `wiki/synthesis`. */
  folder: string;
  title: string;
  body: string;
};

export type WriteVaultNoteResult = {
  absolutePath: string;
  /** Vault-relative, forward slashes. */
  relativePath: string;
};

export async function writeVaultNote(input: WriteVaultNoteInput): Promise<WriteVaultNoteResult> {
  let root: string;
  try {
    root = await fs.realpath(input.vaultDir);
  } catch {
    throw new VaultPathError('Вольт не найден');
  }

  if (typeof input.folder !== 'string' || path.isAbsolute(input.folder) || input.folder.split(/[\\/]/).includes('..')) {
    throw new VaultPathError('Папка вне вольта');
  }
  const folderPath = path.resolve(root, input.folder);
  if (!isInside(root, folderPath)) {
    throw new VaultPathError('Папка вне вольта');
  }
  // Walk down one segment at a time: every existing step is resolved through
  // realpath and must stay inside the vault BEFORE anything below it is
  // created, so a symlink anywhere in the path cannot get a folder made outside.
  let realFolder = root;
  for (const segment of path.relative(root, folderPath).split(path.sep)) {
    const next = path.join(realFolder, segment);
    try {
      await fs.mkdir(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const real = await fs.realpath(next);
    if (!isInside(root, real) || !(await fs.stat(real)).isDirectory()) {
      throw new VaultPathError('Папка вне вольта');
    }
    realFolder = real;
  }

  const slug = slugifyTitle(input.title);
  for (let attempt = 1; attempt <= SUFFIX_LIMIT; attempt += 1) {
    const fileName = attempt === 1 ? `${slug}.md` : `${slug}-${attempt}.md`;
    const absolutePath = path.join(realFolder, fileName);
    try {
      // 'wx' = O_CREAT | O_EXCL: fails on an existing file (or a symlink in its place).
      await fs.writeFile(absolutePath, input.body, { encoding: 'utf8', flag: 'wx' });
      return {
        absolutePath,
        relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue;
      }
      throw error;
    }
  }
  throw new VaultPathError('Не нашлось свободного имени файла');
}

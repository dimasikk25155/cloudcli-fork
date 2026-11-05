/**
 * Puts a credential the user was about to paste into chat into the secrets
 * file instead, and hands back the variable name to mention in its place.
 *
 * Rules that matter more than anything else here:
 *   - the value never appears in a log line, an error message or a response;
 *   - the file is replaced atomically (tmp + rename), so a crash mid-write can
 *     never leave Dima's key file half-written;
 *   - a name taken by a different value gets `_2`, `_3`, …; the same value
 *     under the same name is reused instead of duplicated (the default, used by
 *     the composer). «Запрос ключа» asks for the exact name instead:
 *     `onExisting: 'reject'` refuses a taken name, `'replace'` rewrites its line.
 */

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SECRET_NAME_PATTERN } from '../../../shared/secret-detect.js';

const MAX_NAME_LENGTH = 64;
const MAX_VALUE_LENGTH = 16 * 1024;
const MAX_SUFFIX = 99;

export class StashError extends Error {
  readonly statusCode: number;
  /** Set for refusals a caller tells apart (`SECRET_EXISTS`). */
  readonly code: string | undefined;

  constructor(message: string, statusCode = 400, code?: string) {
    // Messages are fixed strings: nothing derived from the value goes in here.
    super(message);
    this.name = 'StashError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** What to do when the name is already in the file. */
export type StashOnExisting = 'suffix' | 'reject' | 'replace';

export type StashOptions = { file?: string; onExisting?: StashOnExisting };

export function resolveSecretsFile(): string {
  return process.env.NEO3_SECRETS_FILE || path.join(os.homedir(), 'Antigravity Project', '.secrets.env');
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** Reads a dotenv value the way `encodeValue` writes it (plus plain unquoted). */
function decodeValue(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\([\\"$`n])/g, (_m, ch: string) => (ch === 'n' ? '\n' : ch));
  }
  // Unquoted: an inline comment needs whitespace before `#`.
  return value.replace(/\s+#.*$/, '');
}

/**
 * Writes a value both `source .secrets.env` and dotenv read back unchanged
 * for single-line values. Multi-line values (PEM keys) use the dotenv `\n`
 * convention inside double quotes.
 */
function encodeValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+=,%~^-]+$/.test(value)) return value;
  if (!value.includes("'") && !value.includes('\n')) return `'${value}'`;
  return `"${value.replace(/[\\"$`]/g, (ch) => `\\${ch}`).replace(/\r?\n/g, '\\n')}"`;
}

function parseEntries(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of content.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const match = line.match(LINE);
    if (match) entries.set(match[1], decodeValue(match[2]));
  }
  return entries;
}

function validate(input: { name?: unknown; value?: unknown }): { name: string; value: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH || !SECRET_NAME_PATTERN.test(name)) {
    throw new StashError('Имя — заглавные латинские буквы, цифры и _, начинается с буквы');
  }
  const value = typeof input.value === 'string' ? input.value : '';
  if (!value.trim()) throw new StashError('Пустое значение');
  if (value.length > MAX_VALUE_LENGTH) throw new StashError('Значение слишком длинное');
  if (value.includes('\0')) throw new StashError('Значение содержит недопустимые символы');
  return { name, value };
}

async function readIfExists(file: string): Promise<{ content: string; mode: number | null }> {
  try {
    const [content, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    return { content, mode: stat.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { content: '', mode: null };
    throw error;
  }
}

/** Follows a symlinked secrets file so rename replaces the target, not the link. */
async function realTarget(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch {
    return file;
  }
}

async function writeAtomically(file: string, content: string, mode: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    await fs.writeFile(tmp, content, { encoding: 'utf8', mode, flag: 'wx' });
    // writeFile's mode is filtered by umask; set it explicitly.
    await fs.chmod(tmp, mode);
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * The file with every line of `name` replaced by one new line (in the place of
 * the first one, `export ` kept); comments and other names stay as they were.
 */
function replaceEntry(content: string, name: string, value: string): string {
  let written = false;
  const lines: string[] = [];
  for (const line of content.split('\n')) {
    const match = /^\s*#/.test(line) ? null : line.match(LINE);
    if (!match || match[1] !== name) {
      lines.push(line);
      continue;
    }
    if (written) continue;
    written = true;
    lines.push(`${/^\s*export\s+/.test(line) ? 'export ' : ''}${name}=${encodeValue(value)}`);
  }
  const next = lines.join('\n');
  return next.endsWith('\n') ? next : `${next}\n`;
}

// One read-modify-write at a time: two quick stashes must not both pick the
// same free name and drop one of the values.
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export async function stashSecret(
  input: { name?: unknown; value?: unknown },
  options: StashOptions = {},
): Promise<{ name: string }> {
  const { name, value } = validate(input);
  const onExisting = options.onExisting ?? 'suffix';

  return serialized(async () => {
    const file = await realTarget(options.file ?? resolveSecretsFile());
    let existing: { content: string; mode: number | null };
    try {
      existing = await readIfExists(file);
    } catch {
      throw new StashError('Не удалось прочитать файл секретов', 500);
    }

    const entries = parseEntries(existing.content);
    if (onExisting !== 'suffix' && entries.has(name)) {
      if (onExisting === 'reject') throw new StashError('Такой ключ уже есть', 409, 'SECRET_EXISTS');
      try {
        await writeAtomically(file, replaceEntry(existing.content, name, value), existing.mode ?? 0o600);
      } catch {
        throw new StashError('Не удалось записать файл секретов', 500);
      }
      return { name };
    }
    const lastSuffix = onExisting === 'suffix' ? MAX_SUFFIX : 1;
    for (let suffix = 1; suffix <= lastSuffix; suffix += 1) {
      const candidate = suffix === 1 ? name : `${name}_${suffix}`;
      if (candidate.length > MAX_NAME_LENGTH + 4) break;
      const current = entries.get(candidate);
      if (current === value) return { name: candidate };
      if (current !== undefined) continue;

      const separator = existing.content && !existing.content.endsWith('\n') ? '\n' : '';
      const next = `${existing.content}${separator}${candidate}=${encodeValue(value)}\n`;
      try {
        await writeAtomically(file, next, existing.mode ?? 0o600);
      } catch {
        throw new StashError('Не удалось записать файл секретов', 500);
      }
      return { name: candidate };
    }
    throw new StashError('Все варианты имени заняты — выбери другое имя', 409);
  });
}

/** Is there a line for this name in the secrets file? Reads names only; any failure → false. */
export async function secretNameExists(name: string, options: { file?: string } = {}): Promise<boolean> {
  try {
    const file = await realTarget(options.file ?? resolveSecretsFile());
    const { content } = await readIfExists(file);
    return parseEntries(content).has(name);
  } catch {
    return false;
  }
}

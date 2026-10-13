/**
 * What the local model is asked, and what of its answer is accepted
 * (spec story 46, decision 20).
 *
 * The model is trusted with judgement (worth it? which folder? what text?),
 * never with structure: the folder is checked against the vault rule, the
 * frontmatter is rebuilt by us, the H1 is guaranteed and a note without a
 * single [[wikilink]] is rejected as malformed. Links are checked against the
 * real vault: a made-up target becomes plain text, and when nothing real is
 * left the closest note of the session's project is linked instead. The vault
 * is Russian, so a note written in another language is rejected. Secrets are
 * scrubbed both from the transcript going in and from the note coming out.
 */

import { scrubSecrets } from '@/shared/secret-scrub.js';

export type NoteContext = {
  /** YYYY-MM-DD, goes into `created:`. */
  today: string;
  /** Top-level project folders the note may go to (`<Проект>/`). */
  projectFolders: readonly string[];
  /** Every vault note (`wiki/entities/x`, no `.md`); absent → links are not checked. */
  knownNotes?: readonly string[];
  /** Notes of the session's project, best first (see `relatedNotes`). */
  relatedNotes?: readonly string[];
};

export type ParsedNote =
  | { kind: 'skip' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'note'; title: string; folder: string; body: string };

export const FALLBACK_FOLDER = 'wiki/synthesis';
export const TECH_FOLDERS = ['wiki/concepts', 'wiki/synthesis', 'wiki/entities'] as const;
/** Brand/<раздел> sections from the vault rule (Antigravity Project CLAUDE.md). */
export const BRAND_SECTIONS = ['strategy', 'content', 'socials', 'automations', 'website', 'clients'] as const;
export const TRANSCRIPT_MAX_CHARS = 60_000;

const TITLE_MAX = 120;
const BODY_MAX = 20_000;
const LIST_ITEM_MAX = 60;
const LIST_MAX = 8;
const WIKILINK = /\[\[[^\]\n]+\]\]/;
const WIKILINKS = /\[\[([^\]\n|#]+)(#[^\]\n|]*)?(?:\|([^\]\n]+))?\]\]/g;
const RELATED_MAX = 30;
/** Share of Cyrillic among the letters of the prose (code and links excluded). */
const MIN_CYRILLIC_SHARE = 0.4;

export const MEMORY_SYSTEM_PROMPT = [
  'Ты ведёшь базу знаний Obsidian («вольт») разработчика. Тебе дают транскрипт законченной',
  'рабочей сессии с ИИ-агентом. Реши, есть ли в ней факт, который стоит сохранить надолго:',
  'установка или конфиг, фикс бага с причиной, архитектурное решение, runbook, грабли.',
  'Болтовня, разовые вопросы и то, что очевидно из кода, — не стоит.',
  'Если не стоит — верни {"worth": false}.',
  'Если стоит — верни JSON {"worth": true, "title": "…", "folder": "…", "tags": ["…"],',
  '"aliases": ["…"], "body": "…"}.',
  'title — человекочитаемый заголовок на английском, до 120 символов.',
  'folder — строго одно из: wiki/concepts (гайд, паттерн), wiki/synthesis (разбор, итог, баг и фикс),',
  'wiki/entities (сущность: сервис, сервер, инструмент), Brand/<раздел> (бренд, маркетинг, клиенты;',
  `раздел: ${BRAND_SECTIONS.join(', ')}), либо папка проекта из списка в запросе.`,
  'body — markdown по шаблону вольта: frontmatter с полями created, tags, aliases; затем',
  'заголовок H1; одна заметка — одна тема; только факты, списки и таблицы, без воды;',
  'body пиши по-русски (термины, команды и имена файлов — как есть).',
  'обязательно хотя бы одна ссылка [[wikilink]] на родственную заметку — строго из списка',
  'существующих заметок в запросе, путь без .md; новых ссылок не придумывай.',
  'Никогда не переписывай в заметку ключи, токены, пароли и другие секреты.',
].join(' ');

type HistoryMessage = {
  kind?: string;
  role?: string;
  content?: unknown;
  toolName?: unknown;
  toolInput?: unknown;
};

const TOOL_INPUT_MAX = 300;

function toolLine(message: HistoryMessage): string {
  const input = message.toolInput && typeof message.toolInput === 'object'
    ? message.toolInput as Record<string, unknown>
    : null;
  const hint = input
    ? String(input.command ?? input.file_path ?? input.path ?? input.pattern ?? JSON.stringify(input))
    : '';
  const clipped = hint.length > TOOL_INPUT_MAX ? `${hint.slice(0, TOOL_INPUT_MAX)}…` : hint;
  return `[инструмент ${String(message.toolName)}] ${clipped}`.trim();
}

/**
 * Normalized history → plain text for the model: user and assistant text plus
 * one line per tool call. Secrets are scrubbed, then the text is cut to the
 * last 60K characters (the end of a session is where the outcome is).
 */
export function buildTranscript(messages: readonly HistoryMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.kind === 'text' && typeof message.content === 'string' && message.content.trim()) {
      const who = message.role === 'user' ? 'Пользователь' : 'Агент';
      lines.push(`${who}: ${message.content.trim()}`);
    } else if (message.kind === 'tool_use' && typeof message.toolName === 'string') {
      lines.push(toolLine(message));
    }
  }
  const text = scrubSecrets(lines.join('\n\n')).text;
  return text.length > TRANSCRIPT_MAX_CHARS ? text.slice(text.length - TRANSCRIPT_MAX_CHARS) : text;
}

export function buildMemoryPrompt(transcript: string, context: Pick<NoteContext, 'today' | 'projectFolders' | 'relatedNotes'> & { projectName?: string | null }): string {
  const projects = context.projectFolders.length > 0 ? context.projectFolders.join(', ') : 'нет';
  const related = context.relatedNotes ?? [];
  return [
    `Сегодня ${context.today}.`,
    context.projectName ? `Проект сессии: ${context.projectName}.` : '',
    `Папки проектов в вольте: ${projects}.`,
    related.length > 0
      ? `Существующие заметки по проекту (для ссылок [[…]]):\n${related.map((note) => `- ${note}`).join('\n')}`
      : '',
    'Транскрипт сессии (конец):',
    transcript,
    'Ответ — только JSON.',
  ].filter(Boolean).join('\n\n');
}

/** Last resort for a project the vault knows nothing about yet. */
export const VAULT_HUB_NOTE = 'wiki/index';

/**
 * Notes a note about `projectName` should link to, best first: a note named
 * after the project (`wiki/entities/insta-comments`), then the project's own
 * folder, then notes whose name mentions the project, then the vault hub.
 */
export function relatedNotes(knownNotes: readonly string[], projectName?: string | null): string[] {
  const key = (projectName ?? '').trim().toLowerCase();
  const hub = knownNotes.includes(VAULT_HUB_NOTE) ? [VAULT_HUB_NOTE] : [];
  if (!key) return hub;
  const base = (note: string) => note.slice(note.lastIndexOf('/') + 1).toLowerCase();
  const named = knownNotes.filter((note) => base(note) === key);
  const inFolder = knownNotes.filter((note) => note.toLowerCase().startsWith(`${key}/`));
  const mentioned = knownNotes.filter((note) => base(note).includes(key));
  return [...new Set([...named, ...inFolder, ...mentioned].slice(0, RELATED_MAX - hub.length).concat(hub))];
}

/** Obsidian resolution: a full vault path or a bare note name, case-insensitive. */
function linkResolves(target: string, knownNotes: readonly string[]): boolean {
  const wanted = target.trim().replace(/\.md$/i, '').replace(/^\/+/, '').toLowerCase();
  return knownNotes.some((note) => {
    const lower = note.toLowerCase();
    return lower === wanted || lower.endsWith(`/${wanted}`);
  });
}

/**
 * Made-up links become their text; with no real link left, the best related note is linked.
 * Also applied when a note is written, so a suggestion made before a note was
 * renamed (or by an older build) cannot put a dead link into the vault.
 */
export function fixLinks(text: string, knownNotes: readonly string[], related: readonly string[]): string {
  const fixed = text.replace(WIKILINKS, (whole, target: string, _heading: string | undefined, alias: string | undefined) =>
    linkResolves(target, knownNotes) ? whole : (alias ?? target).trim());
  if (WIKILINK.test(fixed) || related.length === 0) return fixed;
  return `${fixed.trimEnd()}\n\n## Связи\n\n- [[${related[0]}]]`;
}

function isMostlyRussian(text: string): boolean {
  const prose = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\[\[[^\]\n]*\]\]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S{25,}/g, ' ');
  const cyrillic = (prose.match(/[а-яё]/gi) ?? []).length;
  const latin = (prose.match(/[a-z]/gi) ?? []).length;
  return cyrillic + latin === 0 || cyrillic / (cyrillic + latin) >= MIN_CYRILLIC_SHARE;
}

/** Folder from the vault rule, or the fallback. Never anything with `..`, absolute or nested beyond the rule. */
export function acceptFolder(raw: unknown, projectFolders: readonly string[]): string {
  if (typeof raw !== 'string') {
    return FALLBACK_FOLDER;
  }
  const folder = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if ((TECH_FOLDERS as readonly string[]).includes(folder)) {
    return folder;
  }
  const brand = /^Brand\/([a-z]+)$/.exec(folder);
  if (brand && (BRAND_SECTIONS as readonly string[]).includes(brand[1])) {
    return folder;
  }
  if (projectFolders.includes(folder) && !folder.includes('/') && folder !== '..' && folder !== '.') {
    return folder;
  }
  return FALLBACK_FOLDER;
}

function cleanList(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.replace(/^\[|\]$/g, '').split(',')
      : [];
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    // A list item must not break the inline YAML list.
    const clean = item.replace(/[[\]\n\r,#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIST_ITEM_MAX);
    if (clean && !result.includes(clean)) result.push(clean);
    if (result.length === LIST_MAX) break;
  }
  return result;
}

/** Splits a leading `---` frontmatter block off; returns its tags/aliases and the rest. */
function splitFrontmatter(body: string): { tags: unknown; aliases: unknown; rest: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(body);
  if (!match) {
    return { tags: undefined, aliases: undefined, rest: body };
  }
  const field = (name: string) => {
    const line = new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(match[1]);
    return line ? line[1].trim() : undefined;
  };
  return { tags: field('tags'), aliases: field('aliases'), rest: body.slice(match[0].length) };
}

export function parseNoteAnswer(raw: unknown, context: NoteContext): ParsedNote {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'invalid', reason: 'not an object' };
  }
  const answer = raw as Record<string, unknown>;
  if (answer.worth === false || answer.worth === 'false') {
    return { kind: 'skip' };
  }
  if (answer.worth !== true && answer.worth !== 'true') {
    return { kind: 'invalid', reason: 'no worth flag' };
  }

  const title = typeof answer.title === 'string'
    ? scrubSecrets(answer.title.replace(/\s+/g, ' ').replace(/^#+\s*/, '').trim()).text
    : '';
  if (!title || title.length > TITLE_MAX) {
    return { kind: 'invalid', reason: 'bad title' };
  }
  if (typeof answer.body !== 'string' || !answer.body.trim()) {
    return { kind: 'invalid', reason: 'empty body' };
  }

  const split = splitFrontmatter(answer.body.trim());
  let rest = split.rest.trim();
  if (!isMostlyRussian(rest)) {
    return { kind: 'invalid', reason: 'not in Russian' };
  }
  if (context.knownNotes) {
    rest = fixLinks(rest, context.knownNotes, context.relatedNotes ?? []);
  }
  if (!WIKILINK.test(rest)) {
    return { kind: 'invalid', reason: 'no wikilink' };
  }
  if (!/^#\s+\S/m.test(rest)) {
    rest = `# ${title}\n\n${rest}`;
  }
  const tags = cleanList(answer.tags ?? split.tags);
  const aliases = cleanList(answer.aliases ?? split.aliases);
  const body = scrubSecrets([
    '---',
    `created: ${context.today}`,
    `tags: [${tags.join(', ')}]`,
    `aliases: [${aliases.join(', ')}]`,
    '---',
    rest,
    '',
  ].join('\n')).text;
  if (body.length > BODY_MAX) {
    return { kind: 'invalid', reason: 'body too long' };
  }

  return { kind: 'note', title, folder: acceptFolder(answer.folder, context.projectFolders), body };
}

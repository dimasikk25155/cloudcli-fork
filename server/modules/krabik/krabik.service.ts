/**
 * «Агент крабик» — Claude-агент на VPS NL, живущий в Herdr (служба
 * `herdr-agents`, пользователь `agents`). Neo3 на маке говорит с ним двумя
 * путями, оба без shell на нашей стороне:
 *
 * - `herdr --machine vps-nl agent get|prompt|send-keys krabik` — статус,
 *   отправка задачи, «Стоп»;
 * - `ssh vps-nl-agents <постоянная команда>` — хвост его JSONL-переписки
 *   (чистые сообщения вместо картинки терминала), список и текст отчётов,
 *   `krabik-ensure` (поднять после перезагрузки сервера).
 *
 * Пользовательский текст уходит только аргументом herdr; в ssh попадают лишь
 * постоянные команды и имя отчёта, прошедшее `REPORT_NAME_RE`.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

import { AppError } from '@/shared/utils.js';

import { stripAgentOnlyBlocks } from '../../../shared/agent-only-blocks.js';

import { normalizeCodexEntry, type TranscriptEntry } from './krabik-codex.js';

const run = promisify(execFile);

const EXEC_OPTS = { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 } as const;

export const KRABIK_AGENT = 'krabik';
export const PROMPT_MAX_CHARS = 8000;
export const REPORT_NAME_RE = /^[\w.-]{1,120}\.md$/;
const MESSAGES_LIMIT = 80;

/** Как Herdr называет состояние агента. */
export type KrabikStatus = 'idle' | 'working' | 'blocked' | 'unknown';

export type KrabikState = {
  provider?: 'claude' | 'codex';
  /** Сервер ответил. false — нет связи (мак без сети, VPS лежит, Herdr не запущен). */
  reachable: boolean;
  status: KrabikStatus;
  /** Над чем работает (заголовок терминала Claude). */
  title: string;
  /** Растёт на каждом законченном ходе — по нему сторож узнаёт «закончил». */
  completionSeq: number;
  error?: string;
};

export type KrabikMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  at: string | null;
};

export type KrabikReport = {
  name: string;
  /** Unix-время изменения, секунды. */
  mtime: number;
  /** Первая строка `СТАТУС: …` без префикса, если есть. */
  status: 'ok' | 'problem' | 'none';
  summary: string;
  /** Первый заголовок `# …` отчёта — человеческое название. */
  title: string;
};

export type Exec = (file: string, args: string[]) => Promise<string>;

export type KrabikDeps = {
  /** Запуск программы без shell; возвращает stdout. */
  exec?: Exec;
  herdrBin?: string;
  sshBin?: string;
  machine?: string;
  sshHost?: string;
  /** Пауза перед проверкой «дошло ли» (тесты подменяют). */
  sleep?: (ms: number) => Promise<void>;
};

/** Сколько ждать после вставки в работающего Крабика, прежде чем проверить. */
export const PROMPT_SETTLE_MS = 2500;

function defaultHerdrBin(): string {
  if (process.env.NEO3_HERDR_BIN) return process.env.NEO3_HERDR_BIN;
  // У LaunchAgent урезан PATH — Homebrew-путь проверяем явно.
  for (const candidate of ['/opt/homebrew/bin/herdr', '/usr/local/bin/herdr']) {
    if (existsSync(candidate)) return candidate;
  }
  return 'herdr';
}

function errorText(err: unknown): string {
  const e = err as { message?: string; stdout?: unknown; stderr?: unknown } | null;
  return [e?.message, e?.stdout, e?.stderr].map((part) => String(part ?? '')).join('\n');
}

const defaultExec: Exec = async (file, args) => {
  const { stdout } = await run(file, args, EXEC_OPTS);
  return String(stdout);
};

// ------------------------------------------------------------ чистые разборы

function asStatus(value: unknown): KrabikStatus {
  return value === 'idle' || value === 'working' || value === 'blocked' ? value : 'unknown';
}

/** Ответ `herdr agent get` → состояние. Битый JSON → нет связи. */
export function parseAgentGet(stdout: string): KrabikState {
  try {
    const agent = JSON.parse(stdout)?.result?.agent;
    if (!agent) throw new Error('no agent');
    return {
      reachable: true,
      status: asStatus(agent.agent_status),
      title: String(agent.terminal_title_stripped || '').replace(/^[\s✳·*]+/, '').trim(),
      completionSeq: Number(agent.completion_seq) || 0,
      ...(agent.agent === 'codex' ? { provider: 'codex' as const } : {}),
    };
  } catch {
    return { reachable: false, status: 'unknown', title: '', completionSeq: 0, error: 'Крабик не ответил' };
  }
}

const NOISE_BLOCK = /<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>/g;

function cleanText(text: string): string {
  return stripAgentOnlyBlocks(String(text || '').replace(NOISE_BLOCK, '')).trim();
}

function shorten(value: string, max: number): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function baseName(path: unknown): string {
  const text = String(path || '');
  return text.split('/').filter(Boolean).pop() || text;
}

/** Один вызов инструмента — одной строкой по-русски. */
export function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const args = input || {};
  switch (name) {
    case 'Bash':
      return `выполняет: ${shorten(String(args.description || args.command || ''), 90)}`;
    case 'Read':
      return `читает ${baseName(args.file_path)}`;
    case 'Write':
      return `пишет ${baseName(args.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `правит ${baseName(args.file_path)}`;
    case 'Grep':
    case 'Glob':
      return `ищет ${shorten(String(args.pattern || ''), 60)}`;
    case 'Agent':
    case 'Task':
      return `зовёт помощника: ${shorten(String(args.description || ''), 60)}`;
    case 'WebFetch':
    case 'WebSearch':
      return 'смотрит в интернете';
    default:
      return `инструмент ${name}`;
  }
}

type QuestionInput = {
  questions?: Array<{ question?: string; options?: Array<{ label?: string; description?: string }> }>;
};

/** Вопрос AskUserQuestion → markdown: вопрос жирным и пронумерованные варианты. */
export function formatQuestion(input: unknown): string {
  const questions = (input as QuestionInput | undefined)?.questions ?? [];
  return questions
    .map((question) => {
      const head = `**❓ ${String(question.question || '').trim()}**`;
      const options = (question.options ?? []).map((option, index) => {
        const label = String(option.label || '').trim();
        const description = String(option.description || '').replace(/\s+/g, ' ').trim();
        return `${index + 1}. ${label}${description ? ` — ${description}` : ''}`;
      });
      return [head, ...options].join('\n');
    })
    .filter((block) => block.length > 8)
    .join('\n\n');
}

/**
 * Хвост JSONL-сессии Claude → пузыри. Подряд идущие вызовы инструментов
 * сворачиваются в одну строку «tool»; ответы инструментов, мета-строки и
 * ветки помощников не показываются. Первая строка хвоста может быть обрезана
 * `tail -c` — битые строки молча пропускаются.
 */
export function parseTranscript(jsonl: string, limit = MESSAGES_LIMIT): KrabikMessage[] {
  const out: KrabikMessage[] = [];
  let source: TranscriptEntry['source'];
  let previousSource: TranscriptEntry['source'];
  const pushMessage = (message: KrabikMessage) => {
    const previous = out.at(-1);
    if (source && previousSource && source !== previousSource && previous?.role === message.role && previous.text === message.text) return;
    out.push(message);
    previousSource = source;
  };
  const pushTool = (id: string, at: string | null, line: string) => {
    const last = out[out.length - 1];
    if (last && last.role === 'tool') {
      const lines = last.text.split('\n');
      if (lines[lines.length - 1] !== line) last.text = `${last.text}\n${line}`;
      return;
    }
    out.push({ id, role: 'tool', text: line, at });
  };

  let line = 0;
  for (const raw of jsonl.split('\n')) {
    line += 1;
    if (!raw.trim()) continue;
    let entry: TranscriptEntry | null;
    try {
      entry = normalizeCodexEntry(JSON.parse(raw), line);
    } catch {
      continue;
    }
    if (!entry || entry.isMeta || entry.isSidechain) continue;
    source = entry.source;
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const id = String(entry.uuid || `${out.length}`);
    const at = entry.timestamp ? String(entry.timestamp) : null;
    const content = entry.message?.content;

    if (entry.type === 'user') {
      if (typeof content === 'string') {
        const text = cleanText(content);
        if (text) pushMessage({ id, role: 'user', text, at });
        continue;
      }
      if (Array.isArray(content)) {
        // Ответы инструментов (tool_result) приходят как user — их не показываем.
        const text = cleanText(
          content
            .filter((part) => part?.type === 'text')
            .map((part) => String(part.text || ''))
            .join('\n'),
        );
        if (text) pushMessage({ id, role: 'user', text, at });
      }
      continue;
    }

    if (!Array.isArray(content)) continue;
    content.forEach((part, index) => {
      if (part?.type === 'text') {
        const text = cleanText(part.text);
        if (!text) return;
        const last = out[out.length - 1];
        // Claude пишет один ответ несколькими строками JSONL — склеиваем.
        if (last && last.role === 'assistant' && last.id === id) last.text = `${last.text}\n\n${text}`;
        else pushMessage({ id, role: 'assistant', text, at });
      } else if (part?.type === 'tool_use' && part.name === 'AskUserQuestion') {
        // Вопрос с вариантами — это реплика для Димы, а не «шаг»: показываем пузырём.
        const text = formatQuestion(part.input);
        if (text) pushMessage({ id: `${id}:${index}`, role: 'assistant', text, at });
      } else if (part?.type === 'tool_use') {
        pushTool(`${id}:${index}`, at, describeTool(String(part.name || ''), part.input));
      }
    });
  }
  return out.slice(-limit);
}

/** `СТАТУС: ОК` / `СТАТУС: ПРОБЛЕМА — …` из первой строки отчёта. */
export function parseReportStatus(firstLine: string): { status: KrabikReport['status']; summary: string } {
  const match = /^\s*\**\s*СТАТУС\s*:\s*\**\s*(.*)$/i.exec(firstLine || '');
  if (!match) return { status: 'none', summary: '' };
  const rest = match[1].replace(/\*+/g, '').trim();
  if (/^(ОК|OK)(?!\p{L})/iu.test(rest)) return { status: 'ok', summary: rest.replace(/^(ОК|OK)\s*[—–-]?\s*/iu, '') };
  if (/^ПРОБЛЕМ/i.test(rest)) return { status: 'problem', summary: rest.replace(/^ПРОБЛЕМ\S*\s*[—–-]?\s*/i, '') };
  return { status: 'none', summary: rest };
}

/** Строки `имя\tmtime\tпервая строка\tзаголовок` → отчёты, свежие сверху. */
export function parseReportList(stdout: string): KrabikReport[] {
  const reports: KrabikReport[] = [];
  for (const line of stdout.split('\n')) {
    const [name, mtime, first = '', heading = ''] = line.split('\t');
    if (!name || !REPORT_NAME_RE.test(name)) continue;
    const { status, summary } = parseReportStatus(first);
    const title = heading.replace(/^#+\s*/, '').replace(/\s+[—–-]\s+(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})$/, '').trim();
    reports.push({ name, mtime: Number(mtime) || 0, status, summary, title });
  }
  return reports.sort((a, b) => b.mtime - a.mtime);
}

// ------------------------------------------------------------ сервис

// Постоянные удалённые команды: в них не попадает ничего от пользователя.
const REMOTE_TRANSCRIPT =
  'if [ -x /usr/local/bin/krabik-transcript ]; then /usr/local/bin/krabik-transcript; else f=$(ls -t ~/.claude/projects/-home-agents-krabik/*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && tail -c 3000000 "$f"; true; fi';
const REMOTE_REPORTS =
  'cd ~/krabik/reports 2>/dev/null || exit 0; ls -t *.md 2>/dev/null | head -60 | while read -r f; do printf "%s\\t%s\\t%s\\t%s\\n" "$f" "$(stat -c %Y "$f")" "$(head -n 1 "$f" | tr "\\t" " ")" "$(grep -m1 "^# " "$f" | tr "\\t" " ")"; done';
const REMOTE_ENSURE = '/usr/local/bin/krabik-ensure';

export function createKrabikService(deps: KrabikDeps = {}) {
  const exec = deps.exec ?? defaultExec;
  const herdr = deps.herdrBin ?? defaultHerdrBin();
  const ssh = deps.sshBin ?? '/usr/bin/ssh';
  const machine = deps.machine ?? process.env.NEO3_KRABIK_MACHINE ?? 'vps-nl';
  const sshHost = deps.sshHost ?? process.env.NEO3_KRABIK_SSH ?? 'vps-nl-agents';
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const herdrArgs = (...rest: string[]) => ['--machine', machine, 'agent', ...rest];
  const remote = (command: string) =>
    exec(ssh, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshHost, command]);

  async function getState(): Promise<KrabikState> {
    // Одна неудача ssh — ещё не «нет связи»: повторяем один раз.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const state = parseAgentGet(await exec(herdr, herdrArgs('get', KRABIK_AGENT)));
        if (state.reachable || attempt === 1) return state;
      } catch {
        // повторим
      }
    }
    return { reachable: false, status: 'unknown', title: '', completionSeq: 0, error: 'Нет связи с сервером' };
  }

  async function getMessages(limit = MESSAGES_LIMIT): Promise<KrabikMessage[]> {
    try {
      return parseTranscript(await remote(REMOTE_TRANSCRIPT), limit);
    } catch {
      return [];
    }
  }

  async function sendPrompt(text: unknown): Promise<void> {
    const prompt = String(text ?? '').trim();
    if (!prompt) throw new AppError('Напиши, что сделать', { code: 'EMPTY_PROMPT', statusCode: 400 });
    if (prompt.length > PROMPT_MAX_CHARS) {
      throw new AppError(`Слишком длинно: до ${PROMPT_MAX_CHARS} знаков`, { code: 'PROMPT_TOO_LONG', statusCode: 400 });
    }
    const before = await getState();
    try {
      await exec(herdr, herdrArgs('prompt', KRABIK_AGENT, prompt));
    } catch (err) {
      if (/agent_blocked/.test(errorText(err))) {
        throw new AppError('Крабик ждёт ответа на вопрос в терминале — сначала ответь на него', {
          code: 'KRABIK_BLOCKED',
          statusCode: 409,
        });
      }
      throw new AppError('Крабик не принял задачу: нет связи с сервером', { code: 'KRABIK_UNREACHABLE', statusCode: 502 });
    }
    // Вставка + Enter в работающий Claude только прерывает его команду, а текст
    // остаётся в поле ввода неотправленным (23.10). Встал в «свободен» — жмём
    // Enter ещё раз: на пустом поле он ничего не делает. При вопросе не жмём —
    // Enter выбрал бы ответ за человека.
    if (before.provider === 'codex' || before.status !== 'working') return;
    await sleep(PROMPT_SETTLE_MS);
    const after = await getState();
    if (after.reachable && after.status === 'idle') {
      await exec(herdr, herdrArgs('send-keys', KRABIK_AGENT, 'enter')).catch(() => undefined);
    }
  }

  async function stop(): Promise<void> {
    try {
      await exec(herdr, herdrArgs('send-keys', KRABIK_AGENT, 'esc'));
    } catch {
      throw new AppError('Не получилось остановить: нет связи с сервером', { code: 'KRABIK_UNREACHABLE', statusCode: 502 });
    }
  }

  /** Поднять Крабика, если его нет (после перезагрузки сервера). */
  async function wake(): Promise<'ok' | 'started'> {
    let out = '';
    try {
      out = (await remote(REMOTE_ENSURE)).trim();
    } catch {
      throw new AppError('Не получилось разбудить Крабика: нет связи с сервером', { code: 'KRABIK_UNREACHABLE', statusCode: 502 });
    }
    if (out === 'ok' || out === 'started') return out;
    throw new AppError('Крабик не запустился на сервере', { code: 'KRABIK_START_FAILED', statusCode: 502 });
  }

  async function listReports(): Promise<KrabikReport[]> {
    try {
      return parseReportList(await remote(REMOTE_REPORTS));
    } catch {
      return [];
    }
  }

  async function readReport(name: unknown): Promise<string> {
    const file = String(name ?? '');
    if (!REPORT_NAME_RE.test(file) || file.startsWith('.')) {
      throw new AppError('Нет такого отчёта', { code: 'BAD_REPORT_NAME', statusCode: 400 });
    }
    try {
      return await remote(`cat ~/krabik/reports/${file}`);
    } catch {
      throw new AppError('Отчёт не открылся', { code: 'REPORT_NOT_FOUND', statusCode: 404 });
    }
  }

  return { getState, getMessages, sendPrompt, stop, wake, listReports, readReport };
}

export type KrabikService = ReturnType<typeof createKrabikService>;

export const krabikService: KrabikService = createKrabikService();

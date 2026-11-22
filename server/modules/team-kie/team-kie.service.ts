/**
 * Kie.ai for teammates, through a gatekeeper.
 *
 * Kie.ai (image / video generation) is paid from Dima's balance with his key
 * `KIE_API_KEY`. The project jail (server/shared/user-jail.ts) hides the key
 * file, and handing the key over would let it be spent anywhere. So jailed
 * engines get a small MCP server instead (Bearer = the run's team token, the
 * same one team-telegram issues):
 * - only the generation endpoints pass, the key never leaves the server;
 * - each teammate has a daily credit limit (Moscow day); spending is measured
 *   as the balance drop around task creation, since Kie charges right then;
 * - reference uploads read files from the teammate's project folder only.
 *
 * Who may use it and the limit live in `~/.cloudcli/team-kie/config.json`
 * (`{"users":["slavik"],"dailyCredits":1000}`), re-read on every call; no file
 * or no user there → the tools are not offered. Spending journal:
 * `~/.cloudcli/team-kie/ledger.json`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { threadsApiUrl } from '@/shared/threads-env.js';

export const KIE_BASE_URL = 'https://api.kie.ai';
export const KIE_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';

/** Generation families of the Kie API: where a task is created and where its status is read. */
export const KIE_APIS = {
  jobs: { create: '/api/v1/jobs/createTask', status: '/api/v1/jobs/recordInfo' },
  veo: { create: '/api/v1/veo/generate', status: '/api/v1/veo/record-info' },
  runway: { create: '/api/v1/runway/generate', status: '/api/v1/runway/record-detail' },
  gpt4o: { create: '/api/v1/gpt4o-image/generate', status: '/api/v1/gpt4o-image/record-info' },
  flux: { create: '/api/v1/flux/kontext/generate', status: '/api/v1/flux/kontext/record-info' },
  suno: { create: '/api/v1/generate', status: '/api/v1/generate/record-info' },
} as const;

export type KieApi = keyof typeof KIE_APIS;

const KIE_API_NAMES = Object.keys(KIE_APIS) as KieApi[];

/** Reference files a teammate may upload (Kie's own upload limit is about this size). */
export const KIE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export const DEFAULT_DAILY_CREDITS = 1000;

export type TeamKieConfig = { users: string[]; dailyCredits: number };

export type TeamKieLedgerEntry = {
  at: string;
  user: string;
  api: KieApi;
  model: string | null;
  taskId: string | null;
  credits: number;
  project: string;
};

export type TeamKieLedger = { days: Record<string, Record<string, number>>; entries: TeamKieLedgerEntry[] };

/** The run's grant as the team token describes it. */
export type TeamKieGrant = { root: string; userId: number };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type TeamKieDependencies = {
  /** Team token → grant (team-telegram issues the run's token). */
  grantFor: (token: string | null | undefined) => TeamKieGrant | null;
  /** User id → login name; null for an unknown user. */
  usernameOf: (userId: number) => string | null;
  readKey?: () => string | null;
  fetchImpl?: FetchLike;
  dir?: string;
  now?: () => Date;
};

export const TEAM_KIE_NOT_ALLOWED =
  'Kie.ai в командном доступе тебе не открыт. Если нужен — передай запрос Диме.';

function defaultDir(): string {
  return process.env.NEO3_TEAM_KIE_DIR || path.join(os.homedir(), '.cloudcli', 'team-kie');
}

/** One key from Dima's secrets file — never the whole file into the process env. */
export function readKieKey(): string | null {
  const fromEnv = process.env.KIE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = process.env.NEO3_SECRETS_FILE || path.join(os.homedir(), 'Antigravity Project', '.secrets.env');
  try {
    const line = fs.readFileSync(file, 'utf8').split('\n').find((entry) => entry.startsWith('KIE_API_KEY='));
    const value = line?.slice('KIE_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '');
    return value || null;
  } catch {
    return null;
  }
}

/** Calendar day in Moscow — the limit resets at Moscow midnight. */
export function moscowDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

type KieEnvelope = { code?: number; msg?: string; data?: unknown };

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const text = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const API_PROPERTY = {
  type: 'string',
  enum: KIE_API_NAMES,
  description: 'Семейство API Kie: jobs (большинство моделей: Nano Banana, Seedream, GPT Image, Kling, Hailuo, Grok Imagine, Wan…), veo, runway, gpt4o, flux, suno. По умолчанию jobs.',
};

export const TEAM_KIE_TOOL_DEFS = [
  {
    name: 'kie_balance',
    description: 'Баланс Kie.ai, сколько кредитов ты потратил сегодня и твой дневной лимит (1 кредит ≈ $0.005).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kie_create_task',
    description: 'Создать задачу генерации в Kie.ai (картинка, видео, музыка). Кредиты списываются сразу при создании. '
      + 'Тело — как в документации модели: для jobs это {"model": "...", "input": {...}}. Каталог моделей и их поля: '
      + 'https://docs.kie.ai/llms.txt. Возвращает taskId; результат — через kie_task_status. callBackUrl не нужен.',
    inputSchema: {
      type: 'object',
      properties: {
        api: API_PROPERTY,
        body: { type: 'object', description: 'Тело запроса создания задачи без ключа.' },
      },
      required: ['body'],
      additionalProperties: false,
    },
  },
  {
    name: 'kie_task_status',
    description: 'Статус задачи Kie.ai по taskId. Когда готово, в ответе ссылки на результат (resultJson / resultUrls) — '
      + 'скачай их в папку проекта (curl -L -o <файл> <url>); ссылки временные.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, api: API_PROPERTY },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'kie_upload_file',
    description: 'Загрузить файл из папки проекта (референс-картинку, видео, звук) в Kie.ai и получить публичную ссылку для input модели. Бесплатно.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Путь к файлу внутри папки проекта (абсолютный или относительно неё).' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
] as const;

export function createTeamKie(dependencies: TeamKieDependencies) {
  const fetchImpl: FetchLike = dependencies.fetchImpl ?? ((url, init) => fetch(url, init));
  const readKey = dependencies.readKey ?? readKieKey;
  const now = dependencies.now ?? (() => new Date());
  const dir = () => dependencies.dir ?? defaultDir();
  const ledgerFile = () => path.join(dir(), 'ledger.json');

  /** Task creations are serialized so each balance drop belongs to exactly one task. */
  let createChain: Promise<unknown> = Promise.resolve();

  function config(): TeamKieConfig {
    const raw = readJson<Partial<TeamKieConfig>>(path.join(dir(), 'config.json'), {});
    const users = Array.isArray(raw.users) ? raw.users.filter((user): user is string => typeof user === 'string') : [];
    const limit = Number(raw.dailyCredits);
    return { users, dailyCredits: Number.isFinite(limit) && limit >= 0 ? limit : DEFAULT_DAILY_CREDITS };
  }

  /** Login of an allowed teammate, or null. */
  function allowedUser(userId: number): string | null {
    const name = dependencies.usernameOf(userId);
    if (!name) return null;
    return config().users.some((user) => user.toLowerCase() === name.toLowerCase()) ? name : null;
  }

  function spentToday(user: string): number {
    const ledger = readJson<TeamKieLedger>(ledgerFile(), { days: {}, entries: [] });
    return ledger.days?.[moscowDay(now())]?.[user.toLowerCase()] ?? 0;
  }

  function record(entry: TeamKieLedgerEntry): void {
    const ledger = readJson<TeamKieLedger>(ledgerFile(), { days: {}, entries: [] });
    ledger.days ??= {};
    ledger.entries ??= [];
    const day = moscowDay(new Date(entry.at));
    const key = entry.user.toLowerCase();
    ledger.days[day] = { ...ledger.days[day], [key]: (ledger.days[day]?.[key] ?? 0) + entry.credits };
    ledger.entries.push(entry);
    if (ledger.entries.length > 2000) ledger.entries = ledger.entries.slice(-2000);
    writeJsonAtomic(ledgerFile(), ledger);
  }

  function requireKey(): string {
    const key = readKey();
    if (!key) throw new Error('ключ Kie.ai на сервере не найден — передай Диме');
    return key;
  }

  async function kie(pathname: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<KieEnvelope> {
    const url = new URL(pathname, KIE_BASE_URL);
    for (const [name, value] of Object.entries(init.query ?? {})) url.searchParams.set(name, value);
    const response = await fetchImpl(url.toString(), {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${requireKey()}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await response.json().catch(() => null)) as KieEnvelope | null;
    if (!body) throw new Error(`Kie.ai ответил ${response.status} без JSON`);
    return body;
  }

  async function balance(): Promise<number> {
    const reply = await kie('/api/v1/chat/credit');
    const credits = Number(reply.data);
    if (reply.code !== 200 || !Number.isFinite(credits)) {
      throw new Error(`не удалось узнать баланс Kie.ai: ${reply.msg ?? reply.code}`);
    }
    return credits;
  }

  function apiOf(value: unknown): KieApi {
    if (value === undefined || value === null || value === '') return 'jobs';
    if (typeof value === 'string' && (KIE_API_NAMES as string[]).includes(value)) return value as KieApi;
    throw new Error(`неизвестное семейство API: ${String(value)}; есть ${KIE_API_NAMES.join(', ')}`);
  }

  async function createTask(grant: TeamKieGrant, user: string, args: Record<string, unknown>): Promise<ToolResult> {
    const api = apiOf(args.api);
    const raw = args.body;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return text('body должен быть объектом запроса', true);
    const body = { ...(raw as Record<string, unknown>) };
    delete body.callBackUrl; // results are polled; Kie must not call anything on our behalf

    const run = createChain.then(async () => {
      const limit = config().dailyCredits;
      const spent = spentToday(user);
      if (spent >= limit) {
        return text(`Дневной лимит Kie.ai исчерпан: потрачено ${spent} из ${limit} кредитов (сброс в полночь по Москве). Больше — только через Диму.`, true);
      }
      const before = await balance();
      const reply = await kie(KIE_APIS[api].create, { method: 'POST', body });
      if (reply.code !== 200) {
        return text(`Kie.ai отказал (code=${reply.code}): ${reply.msg ?? 'без описания'}`, true);
      }
      const after = await balance().catch(() => before);
      const credits = Math.max(0, Math.round((before - after) * 100) / 100);
      const data = (reply.data ?? {}) as Record<string, unknown>;
      const taskId = typeof data.taskId === 'string' ? data.taskId : null;
      record({
        at: now().toISOString(),
        user,
        api,
        model: typeof body.model === 'string' ? body.model : null,
        taskId,
        credits,
        project: path.basename(grant.root),
      });
      return text({ taskId, api, credits, spentToday: spent + credits, dailyLimit: limit, balance: after });
    });
    createChain = run.catch(() => {});
    return run;
  }

  async function taskStatus(args: Record<string, unknown>): Promise<ToolResult> {
    const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : '';
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(taskId)) return text('нужен taskId из kie_create_task', true);
    const reply = await kie(KIE_APIS[apiOf(args.api)].status, { query: { taskId } });
    if (reply.code !== 200) return text(`Kie.ai: ${reply.msg ?? reply.code}`, true);
    return text(reply.data ?? null);
  }

  async function uploadFile(grant: TeamKieGrant, args: Record<string, unknown>): Promise<ToolResult> {
    const requested = typeof args.path === 'string' ? args.path : '';
    if (!requested) return text('нужен путь к файлу в папке проекта', true);
    let file: string;
    let root: string;
    try {
      root = fs.realpathSync(grant.root);
      file = fs.realpathSync(path.resolve(root, requested));
    } catch {
      return text(`файл не найден: ${requested}`, true);
    }
    if (!isInside(root, file)) return text('загружать можно только файлы из папки проекта', true);
    const stat = fs.statSync(file);
    if (!stat.isFile()) return text('это не файл', true);
    if (stat.size > KIE_UPLOAD_MAX_BYTES) return text('файл больше 100 МБ', true);

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
    form.append('uploadPath', 'neo3-team');
    form.append('fileName', path.basename(file));
    const response = await fetchImpl(KIE_UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${requireKey()}` },
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
    const body = (await response.json().catch(() => null)) as KieEnvelope | null;
    const data = (body?.data ?? {}) as Record<string, unknown>;
    const url = [data.downloadUrl, data.fileUrl, data.url].find((value) => typeof value === 'string' && /^https?:\/\//.test(value));
    if (!body || (body.code !== 200 && !body.data) || !url) {
      return text(`загрузка не удалась: ${body?.msg ?? response.status}`, true);
    }
    return text({ url, file: path.relative(root, file) });
  }

  async function callTool(grant: TeamKieGrant, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const user = allowedUser(grant.userId);
    if (!user) return text(TEAM_KIE_NOT_ALLOWED, true);
    try {
      switch (name) {
        case 'kie_balance': {
          const { dailyCredits } = config();
          const spent = spentToday(user);
          return text({ balance: await balance(), spentToday: spent, dailyLimit: dailyCredits, leftToday: Math.max(0, dailyCredits - spent) });
        }
        case 'kie_create_task':
          return await createTask(grant, user, args);
        case 'kie_task_status':
          return await taskStatus(args);
        case 'kie_upload_file':
          return await uploadFile(grant, args);
        default:
          return text(`нет такого инструмента: ${name}`, true);
      }
    } catch (error) {
      return text(`Kie.ai недоступен: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  async function handleMessage(grant: TeamKieGrant, message: RpcMessage): Promise<Record<string, unknown> | null> {
    if (message.id === undefined || message.id === null) return null; // notification
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result });
    switch (message.method) {
      case 'initialize':
        return reply({
          protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'kie', version: '1.0.0' },
          instructions: 'Генерация картинок и видео через Kie.ai с баланса Димы, с дневным лимитом. '
            + 'Порядок: kie_upload_file (если нужен референс) → kie_create_task → kie_task_status до state=success → скачать результат в папку проекта.',
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: allowedUser(grant.userId) ? TEAM_KIE_TOOL_DEFS : [] });
      case 'tools/call': {
        const name = String(message.params?.name ?? '');
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
        return reply(await callTool(grant, name, args));
      }
      default:
        return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
    }
  }

  /** One JSON-RPC body (single or batch) → reply body, or null when it held only notifications. */
  async function handle(grant: TeamKieGrant, body: unknown): Promise<unknown> {
    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map((item) => handleMessage(grant, item as RpcMessage)))).filter(Boolean);
      return replies.length > 0 ? replies : null;
    }
    return handleMessage(grant, (body ?? {}) as RpcMessage);
  }

  return { grantFor: dependencies.grantFor, allowedUser, handle };
}

export type TeamKie = ReturnType<typeof createTeamKie>;

/** Where jailed engines reach the gatekeeper: Neo3's own address, as for threads. */
export function teamKieUrl(): string {
  return threadsApiUrl().replace(/\/api\/threads$/, '/api/team-mcp/kie');
}

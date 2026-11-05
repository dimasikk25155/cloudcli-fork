/**
 * «Запрос ключа»: an agent asks for a secret by NAME, Dima types the value
 * into a hidden field in «Ждут тебя», and it goes into the secrets file through
 * `secrets-stash`. The agent learns only «NAME сохранён» or «Дима отказал».
 *
 * Rules that matter more than anything else here:
 *   - the value lives only in the `answer` call: it is handed to `store` and
 *     dropped. Requests are kept in memory without it; nothing derived from it
 *     goes into a result, an error, a log line, a frame or a notice;
 *   - only an admin asks and answers (`isAdmin`); a switched-off mod refuses
 *     with the registry's text;
 *   - the agent's tool waits for the answer (≤ 10 min) on a timer, never
 *     blocking the event loop; no answer → «спроси позже», the card stays.
 *
 * Every outside effect (file write, frame, push, admin check) comes through deps.
 */

import { randomUUID } from 'node:crypto';

import { isModOn as defaultIsModOn, modOffError, type IsModOn } from '@/shared/mods.js';
import { AppError } from '@/shared/utils.js';

export const SECRET_REQUEST_NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
export const SECRET_REQUEST_WAIT_MS = 600_000;
export const SECRET_REQUEST_WHY_MAX = 500;
/** Open cards per user — an agent in a loop must not flood «Ждут тебя». */
export const SECRET_REQUESTS_MAX = 20;
/** Unanswered cards and answers nobody has picked up are forgotten after a day. */
const KEEP_MS = 24 * 60 * 60 * 1000;

export const SECRET_PENDING_MESSAGE = 'Дима пока не ответил — спроси позже';
export const SECRET_DECLINED_MESSAGE = 'Дима отказал';
export const savedMessage = (name: string) => `${name} сохранён в файле секретов`;

export type SecretRequestView = {
  id: string;
  sessionId: string;
  /** Chat name for the card; null when unknown. */
  sessionTitle: string | null;
  name: string;
  why: string;
  createdAt: string;
  /** The secrets file already has this name — saving needs «заменить». */
  exists: boolean;
};

/** What the agent's tool returns. Never the value. */
export type SecretRequestOutcome = {
  status: 'saved' | 'declined' | 'pending';
  name: string;
  message: string;
  requestId: string;
};

/** A new card, for push + Telegram. */
export type SecretRequestNotice = { userId: number; id: string; sessionId: string; name: string; why: string };

export type SecretRequestsDependencies = {
  isAdmin: (userId: number) => boolean;
  isModOn?: IsModOn;
  /** Writes into the secrets file (`secrets-stash`). A taken name without `replace` → error with code `SECRET_EXISTS`. */
  store: (input: { name: string; value: string; replace: boolean }) => Promise<{ name: string }>;
  /** Is the name already in the secrets file (names only). */
  exists?: (name: string) => Promise<boolean>;
  sessionTitle?: (sessionId: string) => string | null;
  /** Content-free «re-read» frame to the user's sockets. */
  onChange?: (userId: number) => void;
  /** «Агент просит ключ NAME» — push + Telegram. */
  onRequested?: (notice: SecretRequestNotice) => void | Promise<void>;
  now?: () => number;
  newId?: () => string;
  waitMs?: number;
};

type Settled = { status: 'saved' | 'declined'; message: string };

type PendingRequest = {
  id: string;
  userId: number;
  sessionId: string;
  name: string;
  why: string;
  createdAt: number;
  waiters: Set<(settled: Settled) => void>;
};

/** An answer given while no tool call was waiting; the next ask gets it. */
type StoredOutcome = Settled & { requestId: string; at: number };

function refuse(code: string, message: string, statusCode: number): never {
  throw new AppError(message, { code, statusCode });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createSecretRequestsService(deps: SecretRequestsDependencies) {
  const isModOn = deps.isModOn ?? defaultIsModOn;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const waitMs = deps.waitMs ?? SECRET_REQUEST_WAIT_MS;
  const onChange = (userId: number) => {
    try {
      deps.onChange?.(userId);
    } catch {
      // A frame is a hint to re-read; the request itself is fine.
    }
  };

  const pending = new Map<string, PendingRequest>();
  const outcomes = new Map<string, StoredOutcome>();
  const outcomeKey = (userId: number, sessionId: string, name: string) => `${userId}\u0000${sessionId}\u0000${name}`;

  function allow(userId: number): void {
    if (!deps.isAdmin(userId)) refuse('ADMIN_ONLY', 'Ключи просит и сохраняет только администратор', 403);
    if (!isModOn(userId, 'modSecretRequest')) throw modOffError('modSecretRequest');
  }

  function prune(): void {
    const cutoff = now() - KEEP_MS;
    for (const [key, outcome] of outcomes) if (outcome.at < cutoff) outcomes.delete(key);
    for (const [id, request] of pending) {
      if (request.createdAt < cutoff && request.waiters.size === 0) pending.delete(id);
    }
  }

  function ownRequest(userId: number, id: unknown): PendingRequest {
    const request = typeof id === 'string' ? pending.get(id) : undefined;
    if (!request || request.userId !== userId) refuse('SECRET_REQUEST_NOT_FOUND', 'Такого запроса нет — его уже закрыли', 404);
    return request;
  }

  function settle(request: PendingRequest, settled: Settled): void {
    pending.delete(request.id);
    if (request.waiters.size === 0) {
      outcomes.set(outcomeKey(request.userId, request.sessionId, request.name), { ...settled, requestId: request.id, at: now() });
    }
    for (const resolve of request.waiters) resolve(settled);
    request.waiters.clear();
    onChange(request.userId);
  }

  function waitFor(request: PendingRequest): Promise<SecretRequestOutcome> {
    return new Promise((resolve) => {
      const done = (settled: Settled) => {
        clearTimeout(timer);
        resolve({ ...settled, name: request.name, requestId: request.id });
      };
      const timer = setTimeout(() => {
        request.waiters.delete(done);
        resolve({ status: 'pending', name: request.name, message: SECRET_PENDING_MESSAGE, requestId: request.id });
      }, waitMs);
      timer.unref?.();
      request.waiters.add(done);
    });
  }

  /** The agent's `secret.request`: waits for Dima's answer up to `waitMs`. */
  async function request(userId: number, sessionId: string, input: { name?: unknown; why?: unknown }): Promise<SecretRequestOutcome> {
    allow(userId);
    const name = text(input.name);
    if (!SECRET_REQUEST_NAME_RE.test(name)) {
      refuse('SECRET_NAME_INVALID', 'Имя ключа — заглавные латинские буквы, цифры и _, с буквы, 3–64 знака (например FB_PAGE_TOKEN)', 400);
    }
    const why = text(input.why).slice(0, SECRET_REQUEST_WHY_MAX);
    if (!why) refuse('SECRET_WHY_REQUIRED', 'Напиши, зачем ключ: data.why — это увидит Дима', 400);
    prune();

    const key = outcomeKey(userId, sessionId, name);
    const answered = outcomes.get(key);
    if (answered) {
      outcomes.delete(key);
      return { status: answered.status, name, message: answered.message, requestId: answered.requestId };
    }

    let open = [...pending.values()].find((entry) => entry.userId === userId && entry.sessionId === sessionId && entry.name === name);
    if (!open) {
      if ([...pending.values()].filter((entry) => entry.userId === userId).length >= SECRET_REQUESTS_MAX) {
        refuse('TOO_MANY_SECRET_REQUESTS', `Уже ${SECRET_REQUESTS_MAX} запросов ключей ждут ответа — дождись их`, 429);
      }
      open = { id: newId(), userId, sessionId, name, why, createdAt: now(), waiters: new Set() };
      pending.set(open.id, open);
      onChange(userId);
      try {
        await deps.onRequested?.({ userId, id: open.id, sessionId, name, why });
      } catch {
        // Push or Telegram closed: the card in «Ждут тебя» is still there.
      }
    }
    return waitFor(open);
  }

  /** Cards for «Ждут тебя», oldest first. No values: there are none to give. */
  async function list(userId: number): Promise<SecretRequestView[]> {
    allow(userId);
    prune();
    const own = [...pending.values()].filter((entry) => entry.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
    return Promise.all(own.map(async (entry) => ({
      id: entry.id,
      sessionId: entry.sessionId,
      sessionTitle: deps.sessionTitle?.(entry.sessionId) ?? null,
      name: entry.name,
      why: entry.why,
      createdAt: new Date(entry.createdAt).toISOString(),
      exists: deps.exists ? await deps.exists(entry.name).catch(() => false) : false,
    })));
  }

  /** Dima's value → secrets file; the waiting agent hears only the name. */
  async function answer(userId: number, id: string, input: { value?: unknown; replace?: unknown }): Promise<{ name: string; message: string }> {
    allow(userId);
    const request = ownRequest(userId, id);
    const value = typeof input.value === 'string' ? input.value : '';
    if (!value.trim()) refuse('SECRET_VALUE_EMPTY', 'Пустое значение — впиши ключ или откажи', 400);
    try {
      await deps.store({ name: request.name, value, replace: input.replace === true });
    } catch (error) {
      const failure = error as { code?: unknown; statusCode?: unknown; message?: unknown };
      if (failure?.code === 'SECRET_EXISTS') {
        refuse('SECRET_EXISTS', 'Такой ключ уже есть — отметь «Заменить», если его нужно перезаписать', 409);
      }
      // StashError messages are fixed strings; anything else is replaced by one.
      const known = typeof failure?.statusCode === 'number' && error instanceof Error && error.name === 'StashError';
      if (known) refuse('SECRET_STORE_FAILED', String(failure.message), failure.statusCode as number);
      console.error('[secret-requests] store failed', { code: typeof failure?.code === 'string' ? failure.code : 'unknown' });
      refuse('SECRET_STORE_FAILED', 'Не удалось сохранить ключ в файл секретов', 500);
    }
    const message = savedMessage(request.name);
    settle(request, { status: 'saved', message });
    return { name: request.name, message };
  }

  function decline(userId: number, id: string): { message: string } {
    if (!deps.isAdmin(userId)) refuse('ADMIN_ONLY', 'Ключи просит и сохраняет только администратор', 403);
    const request = ownRequest(userId, id);
    settle(request, { status: 'declined', message: SECRET_DECLINED_MESSAGE });
    return { message: SECRET_DECLINED_MESSAGE };
  }

  return { request, list, answer, decline };
}

export type SecretRequestsService = ReturnType<typeof createSecretRequestsService>;

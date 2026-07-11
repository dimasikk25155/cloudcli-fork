import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

/**
 * Live subscription usage for the Claude account this host is logged into.
 *
 * Reads the same OAuth credentials Claude Code itself uses (macOS Keychain
 * first, ~/.claude/.credentials.json as fallback) and asks the same usage
 * endpoint the official clients show in "Accounts and Usage": utilization of
 * the rolling 5-hour window and the 7-day window, with reset timestamps.
 *
 * Responses are cached for a minute — the UI badge polls and every run start
 * consults the guard, so this must stay cheap and must never hammer the API.
 */

export type UsageWindow = {
  utilization: number;
  resetsAt: string | null;
};

export type ClaudeUsageSnapshot = {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  fetchedAt: string;
};

export type UsageGuardState = {
  blocked: boolean;
  pct: number | null;
  threshold: number;
  resetsAt: string | null;
};

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_TTL_MS = 60_000;

/**
 * Share of the 5-hour window at which new runs are held back. The remainder
 * is deliberately reserved so the subscription owner can still ask questions
 * after agents chewed through the window. Override per launch environment
 * with USAGE_GUARD_PCT; <=0 or >=100 disables the guard.
 */
export const USAGE_GUARD_DEFAULT_PCT = 90;

let cached: { at: number; snapshot: ClaudeUsageSnapshot | null } | null = null;

function readKeychainAccessToken(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  try {
    const result = spawn.sync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', timeout: 5000 },
    );
    if (result.status !== 0 || !result.stdout) {
      return null;
    }
    const oauth = JSON.parse(result.stdout)?.claudeAiOauth;
    const token = typeof oauth?.accessToken === 'string' ? oauth.accessToken : null;
    const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : null;
    if (!token || (expiresAt && Date.now() >= expiresAt)) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

async function readCredentialsFileAccessToken(): Promise<string | null> {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const oauth = JSON.parse(await readFile(credPath, 'utf8'))?.claudeAiOauth;
    const token = typeof oauth?.accessToken === 'string' ? oauth.accessToken : null;
    const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : null;
    if (!token || (expiresAt && Date.now() >= expiresAt)) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

function readUsageWindow(value: unknown): UsageWindow | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const utilization = Number(record.utilization);
  if (!Number.isFinite(utilization)) {
    return null;
  }
  return {
    utilization,
    resetsAt: typeof record.resets_at === 'string' ? record.resets_at : null,
  };
}

/**
 * Fetches (or serves from the 60s cache) the current subscription usage.
 * Returns null when credentials are missing/expired or the endpoint fails —
 * callers treat that as "usage unknown", never as an error.
 */
export async function getClaudeUsage(): Promise<ClaudeUsageSnapshot | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.snapshot;
  }

  let snapshot: ClaudeUsageSnapshot | null = null;
  try {
    const token = readKeychainAccessToken() ?? await readCredentialsFileAccessToken();
    if (token) {
      const response = await fetch(USAGE_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const payload = await response.json() as Record<string, unknown>;
        snapshot = {
          fiveHour: readUsageWindow(payload.five_hour),
          sevenDay: readUsageWindow(payload.seven_day),
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  } catch {
    snapshot = null;
  }

  // Failures are cached too, so a broken credential can't turn every run
  // start and badge poll into a fresh network round-trip.
  cached = { at: Date.now(), snapshot };
  return snapshot;
}

export function resolveUsageGuardThreshold(): number {
  const raw = Number(process.env.USAGE_GUARD_PCT);
  if (Number.isFinite(raw) && raw > 0 && raw < 100) {
    return raw;
  }
  return USAGE_GUARD_DEFAULT_PCT;
}

/**
 * Should a new run be held back right now? Fails open: unknown usage never
 * blocks (the API guard exists to protect the reserve, not to brick the app).
 */
export async function checkUsageGuard(): Promise<UsageGuardState> {
  const threshold = resolveUsageGuardThreshold();
  const usage = await getClaudeUsage();
  const pct = usage?.fiveHour?.utilization ?? null;
  return {
    blocked: pct !== null && pct >= threshold,
    pct,
    threshold,
    resetsAt: usage?.fiveHour?.resetsAt ?? null,
  };
}

/** Human-readable Moscow wall-clock time for a usage reset timestamp. */
export function formatResetMoscow(resetsAt: string | null): string {
  if (!resetsAt) {
    return 'неизвестно';
  }
  try {
    const time = new Date(resetsAt).toLocaleTimeString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${time} МСК`;
  } catch {
    return 'неизвестно';
  }
}

export function buildUsageGuardNotice(guard: UsageGuardState): string {
  const pct = guard.pct === null ? '≥' + guard.threshold : Math.round(guard.pct);
  return [
    `⛔ Использовано ${pct}% 5-часового лимита подписки (порог ${guard.threshold}%).`,
    `Новые прогоны придержаны — остаток зарезервирован под твои личные вопросы.`,
    `Окно сбросится в ${formatResetMoscow(guard.resetsAt)}.`,
    `Если запустить всё равно надо — отправь сообщение ещё раз и подтверди запуск.`,
  ].join('\n');
}

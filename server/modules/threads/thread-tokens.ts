/**
 * Thread tokens: the identity an agent's Neo3 MCP server acts with.
 *
 * One token per run of a chat, put into the engine process environment
 * (`NEO3_THREADS_TOKEN`). It is bound to that chat and its user and stays
 * valid while the run goes and 24 hours after it ended. Only the SHA-256 of
 * the token is stored, so the database never holds a usable credential.
 */

import { createHash, randomBytes } from 'node:crypto';

import { threadTokensDb } from '@/modules/database/index.js';

export const THREAD_TOKEN_TTL_AFTER_RUN_MS = 24 * 60 * 60 * 1000;

export type ThreadTokenOwner = {
  /** App session id of the run the token was issued for. */
  sessionId: string;
  userId: number;
  /** Permission mode of that run — threads and the «Треды готовы» message reuse it. */
  permissionMode: string | null;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toUserId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function createThreadTokens(dependencies: { now?: () => Date } = {}) {
  const now = dependencies.now ?? (() => new Date());

  return {
    /** New token for one run; null when the run has no user (nothing to act for). */
    issue(input: { sessionId: string; userId: unknown; permissionMode?: unknown }): string | null {
      const userId = toUserId(input.userId);
      if (!input.sessionId || userId === null) {
        return null;
      }
      const token = randomBytes(32).toString('hex');
      const issuedAt = now();
      // Housekeeping on the way: expired tokens are dropped while the server runs.
      threadTokensDb.deleteExpired(issuedAt.toISOString());
      threadTokensDb.insert({
        token_hash: hashToken(token),
        session_id: input.sessionId,
        user_id: userId,
        permission_mode: typeof input.permissionMode === 'string' && input.permissionMode ? input.permissionMode : null,
        issued_at: issuedAt.toISOString(),
        expires_at: null,
      });
      return token;
    },

    /** The run ended: the token lives 24 more hours (set once; later calls change nothing). */
    end(token: string | null | undefined): void {
      if (!token) return;
      threadTokensDb.setExpiry(hashToken(token), new Date(now().getTime() + THREAD_TOKEN_TTL_AFTER_RUN_MS).toISOString());
    },

    /** Owner of a valid token, or null (unknown, malformed or expired). */
    resolve(token: unknown): ThreadTokenOwner | null {
      if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
        return null;
      }
      const row = threadTokensDb.get(hashToken(token));
      if (!row) {
        return null;
      }
      if (row.expires_at !== null && new Date(row.expires_at).getTime() <= now().getTime()) {
        return null;
      }
      return { sessionId: row.session_id, userId: row.user_id, permissionMode: row.permission_mode };
    },

    /**
     * Server start: runs of the previous process are gone without reporting
     * their end — their tokens get the usual 24 hours from now. Long-expired
     * rows are dropped.
     */
    reconcileOnBoot(): void {
      const current = now();
      threadTokensDb.expireOpen(new Date(current.getTime() + THREAD_TOKEN_TTL_AFTER_RUN_MS).toISOString());
      threadTokensDb.deleteExpired(current.toISOString());
    },
  };
}

export type ThreadTokens = ReturnType<typeof createThreadTokens>;

export const threadTokens: ThreadTokens = createThreadTokens();

import { getConnection } from '@/modules/database/connection.js';

export type TelegramBindingRow = {
  id: number;
  user_id: number;
  chat_id: string;
  telegram_username: string | null;
  project_path: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type TelegramLinkCodeRow = {
  code: string;
  user_id: number;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

type UpsertBindingInput = {
  userId: number;
  chatId: string;
  telegramUsername?: string | null;
  projectPath?: string | null;
};

const BINDING_COLUMNS = 'id, user_id, chat_id, telegram_username, project_path, enabled, created_at, updated_at';
const LINK_CODE_COLUMNS = 'code, user_id, expires_at, used_at, created_at';

function normalizeChatId(chatId: unknown): string {
  if (typeof chatId === 'number') return String(chatId);
  return typeof chatId === 'string' ? chatId.trim() : '';
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export const telegramDb = {
  // --- link codes -----------------------------------------------------------

  /**
   * Issues a code with its lifetime computed by SQLite itself. Timestamps in
   * this table are only ever compared against CURRENT_TIMESTAMP, so letting the
   * database produce both sides keeps the formats identical.
   */
  createLinkCode(userId: number, code: string, ttlSeconds: number): TelegramLinkCodeRow {
    const db = getConnection();
    const seconds = Math.max(1, Math.floor(ttlSeconds));
    return db.prepare(`
      INSERT INTO telegram_link_codes (code, user_id, expires_at)
      VALUES (?, ?, datetime('now', ?))
      RETURNING ${LINK_CODE_COLUMNS}
    `).get(code, userId, `+${seconds} seconds`) as TelegramLinkCodeRow;
  },

  /**
   * Marks a code used and returns it, but only while it is still unused and
   * unexpired. Both halves happen in one statement so a code cannot be redeemed
   * twice by two updates arriving together.
   */
  consumeLinkCode(code: string): TelegramLinkCodeRow | null {
    const db = getConnection();
    const normalized = typeof code === 'string' ? code.trim() : '';
    if (!normalized) return null;

    const row = db.prepare(`
      UPDATE telegram_link_codes
      SET used_at = CURRENT_TIMESTAMP
      WHERE code = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      RETURNING ${LINK_CODE_COLUMNS}
    `).get(normalized) as TelegramLinkCodeRow | undefined;

    return row ?? null;
  },

  /** Drops a user's pending codes — called before issuing a new one, so only the freshest code works. */
  deleteUserLinkCodes(userId: number): number {
    const db = getConnection();
    return db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ?').run(userId).changes;
  },

  deleteExpiredLinkCodes(): number {
    const db = getConnection();
    return db.prepare(
      "DELETE FROM telegram_link_codes WHERE expires_at <= CURRENT_TIMESTAMP OR used_at IS NOT NULL"
    ).run().changes;
  },

  // --- bindings -------------------------------------------------------------

  /**
   * Binds a chat to a user. Re-binding an existing chat to a *different* user
   * clears the stored project: the new owner must pick from their own projects
   * rather than inherit the previous owner's selection.
   */
  upsertBinding(input: UpsertBindingInput): TelegramBindingRow {
    const chatId = normalizeChatId(input.chatId);
    if (!chatId) throw new Error('chatId is required');

    const db = getConnection();
    db.prepare(`
      INSERT INTO telegram_bindings (user_id, chat_id, telegram_username, project_path, enabled, updated_at)
      VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(chat_id) DO UPDATE SET
        user_id = excluded.user_id,
        telegram_username = excluded.telegram_username,
        project_path = CASE
          WHEN telegram_bindings.user_id = excluded.user_id THEN telegram_bindings.project_path
          ELSE NULL
        END,
        enabled = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      input.userId,
      chatId,
      normalizeNullableText(input.telegramUsername),
      normalizeNullableText(input.projectPath)
    );

    return telegramDb.getBindingByChatId(chatId)!;
  },

  getBindingByChatId(chatId: string): TelegramBindingRow | null {
    const db = getConnection();
    const row = db.prepare(
      `SELECT ${BINDING_COLUMNS} FROM telegram_bindings WHERE chat_id = ?`
    ).get(normalizeChatId(chatId)) as TelegramBindingRow | undefined;
    return row ?? null;
  },

  getBindingsByUserId(userId: number): TelegramBindingRow[] {
    const db = getConnection();
    return db.prepare(
      `SELECT ${BINDING_COLUMNS} FROM telegram_bindings WHERE user_id = ? ORDER BY created_at DESC`
    ).all(userId) as TelegramBindingRow[];
  },

  /**
   * Every binding, regardless of owner. Only for server-side senders that have
   * no user in scope (the server-panel alert loop picks a fallback chat here);
   * user-facing code must keep using the user-scoped queries above.
   */
  listBindings(): TelegramBindingRow[] {
    const db = getConnection();
    return db.prepare(
      `SELECT ${BINDING_COLUMNS} FROM telegram_bindings ORDER BY created_at ASC`
    ).all() as TelegramBindingRow[];
  },

  /** Scoped by user_id on purpose: one user must never edit another user's binding. */
  setBindingProjectPath(userId: number, chatId: string, projectPath: string | null): boolean {
    const db = getConnection();
    const result = db.prepare(`
      UPDATE telegram_bindings
      SET project_path = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND chat_id = ?
    `).run(normalizeNullableText(projectPath), userId, normalizeChatId(chatId));
    return result.changes > 0;
  },

  setBindingEnabled(userId: number, chatId: string, enabled: boolean): boolean {
    const db = getConnection();
    const result = db.prepare(`
      UPDATE telegram_bindings
      SET enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND chat_id = ?
    `).run(enabled ? 1 : 0, userId, normalizeChatId(chatId));
    return result.changes > 0;
  },

  deleteBinding(userId: number, chatId: string): boolean {
    const db = getConnection();
    const result = db.prepare(
      'DELETE FROM telegram_bindings WHERE user_id = ? AND chat_id = ?'
    ).run(userId, normalizeChatId(chatId));
    return result.changes > 0;
  },
};

/**
 * Provider preferences repository.
 *
 * Stores per-user "default model" and "default thinking effort" per provider
 * as JSON, so the choice made on one device (Mac) is what every other device
 * (phone) sees too, instead of being stuck in one browser's localStorage.
 */

import { getConnection } from '@/modules/database/connection.js';

export type ProviderPreferences = {
  models: Record<string, string>;
  efforts: Record<string, string>;
};

function parseRecord(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export const providerPreferencesDb = {
  /** Returns the stored model/effort maps for a user, or empty maps if unset. */
  getProviderPreferences(userId: number): ProviderPreferences {
    const db = getConnection();
    const row = db
      .prepare('SELECT models_json, efforts_json FROM user_provider_preferences WHERE user_id = ?')
      .get(userId) as { models_json: string; efforts_json: string } | undefined;

    if (!row) {
      return { models: {}, efforts: {} };
    }

    return {
      models: parseRecord(row.models_json),
      efforts: parseRecord(row.efforts_json),
    };
  },

  /** Upserts one provider's default model, preserving every other provider's value. */
  setProviderModel(userId: number, provider: string, model: string): ProviderPreferences {
    const current = providerPreferencesDb.getProviderPreferences(userId);
    const next: ProviderPreferences = {
      models: { ...current.models, [provider]: model },
      efforts: current.efforts,
    };
    providerPreferencesDb.upsert(userId, next);
    return next;
  },

  /** Upserts one provider's default thinking effort, preserving the rest. */
  setProviderEffort(userId: number, provider: string, effort: string): ProviderPreferences {
    const current = providerPreferencesDb.getProviderPreferences(userId);
    const next: ProviderPreferences = {
      models: current.models,
      efforts: { ...current.efforts, [provider]: effort },
    };
    providerPreferencesDb.upsert(userId, next);
    return next;
  },

  upsert(userId: number, preferences: ProviderPreferences): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO user_provider_preferences (user_id, models_json, efforts_json, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         models_json = excluded.models_json,
         efforts_json = excluded.efforts_json,
         updated_at = CURRENT_TIMESTAMP`
    ).run(userId, JSON.stringify(preferences.models), JSON.stringify(preferences.efforts));
  },
};

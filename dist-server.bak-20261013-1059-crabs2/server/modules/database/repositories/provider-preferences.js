/**
 * Provider preferences repository.
 *
 * Stores per-user "default model" and "default thinking effort" per provider
 * as JSON, so the choice made on one device (Mac) is what every other device
 * (phone) sees too, instead of being stuck in one browser's localStorage.
 */
import { getConnection } from '../../../modules/database/connection.js';
function parseRecord(json) {
    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        const entries = Object.entries(parsed)
            .filter((entry) => typeof entry[1] === 'string');
        return Object.fromEntries(entries);
    }
    catch {
        return {};
    }
}
export const providerPreferencesDb = {
    /** Returns the stored model/effort maps for a user, or empty maps if unset. */
    getProviderPreferences(userId) {
        const db = getConnection();
        const row = db
            .prepare('SELECT models_json, efforts_json, work_mode, default_provider FROM user_provider_preferences WHERE user_id = ?')
            .get(userId);
        if (!row) {
            return { models: {}, efforts: {}, workMode: null, defaultProvider: null };
        }
        return {
            models: parseRecord(row.models_json),
            efforts: parseRecord(row.efforts_json),
            workMode: row.work_mode ?? null,
            defaultProvider: row.default_provider ?? null,
        };
    },
    /** Upserts one provider's default model, preserving every other provider's value. */
    setProviderModel(userId, provider, model) {
        const current = providerPreferencesDb.getProviderPreferences(userId);
        const next = {
            ...current,
            models: { ...current.models, [provider]: model },
        };
        providerPreferencesDb.upsert(userId, next);
        return next;
    },
    /** Upserts one provider's default thinking effort, preserving the rest. */
    setProviderEffort(userId, provider, effort) {
        const current = providerPreferencesDb.getProviderPreferences(userId);
        const next = {
            ...current,
            efforts: { ...current.efforts, [provider]: effort },
        };
        providerPreferencesDb.upsert(userId, next);
        return next;
    },
    /** Upserts the work mode new chats start in, preserving model/effort defaults. */
    setWorkMode(userId, workMode) {
        const next = {
            ...providerPreferencesDb.getProviderPreferences(userId),
            workMode,
        };
        providerPreferencesDb.upsert(userId, next);
        return next;
    },
    /** Upserts the engine new chats open on (null restores "last used wins"). */
    setDefaultProvider(userId, defaultProvider) {
        const next = {
            ...providerPreferencesDb.getProviderPreferences(userId),
            defaultProvider,
        };
        providerPreferencesDb.upsert(userId, next);
        return next;
    },
    upsert(userId, preferences) {
        const db = getConnection();
        db.prepare(`INSERT INTO user_provider_preferences (user_id, models_json, efforts_json, work_mode, default_provider, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         models_json = excluded.models_json,
         efforts_json = excluded.efforts_json,
         work_mode = excluded.work_mode,
         default_provider = excluded.default_provider,
         updated_at = CURRENT_TIMESTAMP`).run(userId, JSON.stringify(preferences.models), JSON.stringify(preferences.efforts), preferences.workMode ?? null, preferences.defaultProvider ?? null);
    },
};
//# sourceMappingURL=provider-preferences.js.map
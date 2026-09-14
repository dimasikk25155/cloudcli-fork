const USER_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT,
    has_completed_onboarding BOOLEAN DEFAULT 0,
    role TEXT NOT NULL DEFAULT 'user'
);
`;

export const API_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_CREDENTIALS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL, -- 'github_token', 'gitlab_token', 'bitbucket_token', etc.
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_notification_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const VAPID_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS vapid_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notification_channel_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    label TEXT,
    metadata_json TEXT,
    enabled BOOLEAN DEFAULT 1,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, channel, endpoint_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const PROJECTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    project_path TEXT NOT NULL UNIQUE,
    custom_project_name TEXT DEFAULT NULL,
    isStarred BOOLEAN DEFAULT 0,
    isArchived BOOLEAN DEFAULT 0
);
`;

export const SESSIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    -- The session id used by the provider CLI/SDK on disk (JSONL file name,
    -- store.db folder, sqlite row id, ...). \`session_id\` is the stable
    -- app-facing id that the frontend uses for the whole session lifetime;
    -- \`provider_session_id\` is filled in once the provider announces its own
    -- id mid-run, or equals \`session_id\` for sessions discovered on disk.
    provider_session_id TEXT,
    custom_name TEXT,
    project_path TEXT,
    jsonl_path TEXT,
    -- Per-session model/thinking-effort override: NULL means "no override
    -- for this session yet", so callers fall back to the user's account-wide
    -- default (see USER_PROVIDER_PREFERENCES_TABLE_SCHEMA_SQL below).
    model TEXT,
    effort TEXT,
    isArchived BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id),
    FOREIGN KEY (project_path) REFERENCES projects(project_path)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);
`;

// Per-employee project allow-list for multi-user installs. Admins bypass
// this table entirely (see requireAdmin/role checks) — it only restricts
// non-admin users, and an empty result set means "no projects visible",
// not "all projects" (fail-closed default).
export const USER_PROJECT_ACCESS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_project_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    granted_by INTEGER,
    UNIQUE(user_id, project_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
);
`;

export const LAST_SCANNED_AT_SQL = `
CREATE TABLE IF NOT EXISTS scan_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_scanned_at TIMESTAMP NULL
);
`;

export const APP_CONFIG_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

// Cross-device sync for the "which model / thinking effort should new
// messages use" choice: one row per user, JSON-encoded per-provider maps, so
// picking a model on the Mac shows up on the phone (and vice versa) instead
// of being stuck in that one browser's localStorage.
export const USER_PROVIDER_PREFERENCES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_provider_preferences (
    user_id INTEGER PRIMARY KEY,
    models_json TEXT NOT NULL DEFAULT '{}',
    efforts_json TEXT NOT NULL DEFAULT '{}',
    -- Work mode a new chat starts in (see server/shared/work-mode.ts). Not
    -- per-provider: only the Claude runtime carries it, and it describes how
    -- the user wants to be talked to rather than a property of an engine.
    work_mode TEXT,
    -- Engine every NEW chat opens on (e.g. 'grok'). NULL means the historic
    -- behaviour: a new chat sticks to whatever engine was used last.
    default_provider TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

// Cross-device sync for appearance/behavior toggles (theme, shader background,
// composer/sidebar toggles) that used to live only in that browser's
// localStorage and reset on every fresh install or new device.
export const USER_UI_PREFERENCES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_ui_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

// A saved chain of steps. Each step is { name, projectPath, prompt } and runs
// headlessly in its own project, so one chain can cross project boundaries.
export const PIPELINES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pipelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    steps_json TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const PIPELINE_RUNS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    trigger TEXT NOT NULL DEFAULT 'manual',
    artifacts_dir TEXT,
    error TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const PIPELINE_RUN_STEPS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pipeline_run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    step_index INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    project_path TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    session_id TEXT,
    output_preview TEXT NOT NULL DEFAULT '',
    error TEXT,
    started_at DATETIME,
    finished_at DATETIME,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
);
`;

// A recurring run owned by the app itself. os_label ties the row to whatever the
// host scheduler created (launchd label on macOS, systemd timer unit on Linux),
// so the two can be reconciled after a crash or a manual deletion.
export const SCHEDULES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'prompt',
    project_path TEXT,
    prompt TEXT NOT NULL DEFAULT '',
    pipeline_id INTEGER,
    hour INTEGER NOT NULL,
    minute INTEGER NOT NULL,
    weekdays TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    os_label TEXT,
    last_run_at DATETIME,
    last_status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE SET NULL
);
`;

// One Telegram chat bound to one app user. The binding is what grants access:
// an unbound chat gets nothing, so a stranger who finds the bot cannot reach
// any project.
export const TELEGRAM_BINDINGS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS telegram_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    chat_id TEXT NOT NULL UNIQUE,
    telegram_username TEXT,
    project_path TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

// Append-only record of every run this installation performed, and what it cost.
//
// Two questions had no answer before this table existed:
//   1. "What did the agent do last night?" — unattended runs (schedules,
//      pipelines, Telegram) leave no trace anywhere.
//   2. "Where did the money go?" — token counts existed per session, but never
//      attributed to a run, a trigger or a project.
//
// `actor` is deliberately separate from `user_id`: a schedule runs *on behalf
// of* a user, but that user did not start it. Collapsing the two makes the
// central audit question unanswerable.
//
// `run_id` rather than `session_id` is the unit of grouping — one session hosts
// dozens of runs, and the feed answers "what did this one run do".
//
// Money is stored as integer micro-USD. Summing floats across thousands of rows
// drifts, and this number is what a spend cap will eventually be compared to.
export const AUDIT_LOG_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    day_msk TEXT NOT NULL,
    user_id INTEGER,
    actor TEXT NOT NULL,
    project_id TEXT,
    project_path TEXT,
    session_id TEXT,
    run_id TEXT,
    event TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    tool_name TEXT,
    detail TEXT NOT NULL DEFAULT '',
    outcome TEXT,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cache_read INTEGER NOT NULL DEFAULT 0,
    cache_write_5m INTEGER NOT NULL DEFAULT 0,
    cache_write_1h INTEGER NOT NULL DEFAULT 0,
    cost_micro_usd INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
`;

// An audit log that can be edited is not an audit log. UPDATE and DELETE are
// refused at the database level, so neither a bug nor a future feature can
// quietly rewrite history — only the file itself can be tampered with, and that
// is outside what the app can defend against.
export const AUDIT_LOG_GUARD_SQL = `
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`;

// Indexes and the idempotency guard, kept next to the table so migrations and
// fresh installs apply exactly the same set.
//
// The unique index on run.finish is what makes metering safe to retry: a run
// that is re-reported (transient retry, reconnect) cannot bill twice.
export const AUDIT_LOG_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_audit_day ON audit_log(day_msk, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_log(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_day ON audit_log(user_id, day_msk);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_run_finish
    ON audit_log(run_id) WHERE event = 'run.finish' AND run_id IS NOT NULL;
`;

// Short-lived codes a user pastes into the bot to prove the chat is theirs.
export const TELEGRAM_LINK_CODES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS telegram_link_codes (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const INIT_SCHEMA_SQL = `
-- Initialize authentication database
PRAGMA foreign_keys = ON;

${USER_TABLE_SCHEMA_SQL}
-- Indexes for performance for user lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
-- NOTE: idx_users_active is created in migrations, after is_active is added.
-- Creating it here crashes the server on upgraded installs whose users table predates
-- that column — CREATE TABLE IF NOT EXISTS leaves the old shape untouched.

${API_KEYS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

${USER_CREDENTIALS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

${USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id ON user_notification_preferences(user_id);

${VAPID_KEYS_TABLE_SCHEMA_SQL}

${PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

${NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_user_channel ON notification_channel_endpoints(user_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_enabled ON notification_channel_endpoints(enabled);

${PROJECTS_TABLE_SCHEMA_SQL}
-- NOTE: These indexes are created in migrations after legacy table-shape repairs.
-- Creating them here can fail on upgraded installs where projects lacks those columns.

${USER_PROJECT_ACCESS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_project_access_user_id ON user_project_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_project_access_project_id ON user_project_access(project_id);

${SESSIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id);
-- NOTE: This index is created in migrations after sessions is rebuilt to include project_path.
-- Creating it here can fail on upgraded installs where the legacy sessions table has no project_path.

${USER_PROVIDER_PREFERENCES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_provider_preferences_user_id ON user_provider_preferences(user_id);

${USER_UI_PREFERENCES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_ui_preferences_user_id ON user_ui_preferences(user_id);

${PIPELINES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_pipelines_user_id ON pipelines(user_id);

${PIPELINE_RUNS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline_id ON pipeline_runs(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_id ON pipeline_runs(user_id);

${PIPELINE_RUN_STEPS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_pipeline_run_steps_run_id ON pipeline_run_steps(run_id);

${SCHEDULES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);

${TELEGRAM_BINDINGS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_telegram_bindings_chat_id ON telegram_bindings(chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bindings_user_id ON telegram_bindings(user_id);

${TELEGRAM_LINK_CODES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user_id ON telegram_link_codes(user_id);

${AUDIT_LOG_TABLE_SCHEMA_SQL}
${AUDIT_LOG_INDEXES_SQL}
${AUDIT_LOG_GUARD_SQL}

${LAST_SCANNED_AT_SQL}

${APP_CONFIG_TABLE_SCHEMA_SQL}
`;

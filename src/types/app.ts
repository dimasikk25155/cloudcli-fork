import type { SessionLinks } from '../../shared/session-links';

/**
 * Mirror of `GatewayEventKind` in `server/shared/types.ts`: app-level websocket
 * kinds emitted by the gateway on top of provider message kinds. Keep both
 * unions identical.
 */
export type GatewayEventKind =
  | 'chat_subscribed'
  | 'session_upserted'
  | 'loading_progress'
  | 'protocol_error'
  /** Session status changed; payload `{sessionId, timestamp}` only — re-read `/api/attention`. */
  | 'attention_changed'
  /**
   * Vault-note suggestions changed (proposed, written, dismissed). Content-free
   * (`{kind, sessionId, timestamp}`); clients re-read `GET /api/memory-suggestions`.
   * Mirrored in `server/shared/types.ts` `GatewayEventKind`.
   */
  | 'memory_suggestions_changed'
  /**
   * Claude background tasks of a session changed: `{sessionId, tasks:[{taskId,
   * kind, description, startedAt, lastTool?}]}`, the full list (replace).
   * Not a chat row. Mirrored in `server/shared/types.ts` `GatewayEventKind`.
   */
  | 'background_tasks'
  /** Answer to `chat.stop-task`: `{sessionId, taskId, ok, reason?}`. Not a chat row. */
  | 'background_task_stop';

export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'opencode' | 'kimi' | 'gemini' | 'grok';

export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  /**
   * Keeps a model out of the pickers without unwiring it. A hidden model still
   * runs if a session or localStorage already points at it — this is only the
   * "do not offer it to me" switch for models that are wired up but not in
   * daily use (21.08.2026: the local RTX ones and the BYO gateways).
   */
  hidden?: boolean;
  /** Maximum context supported by the installed provider for this model. */
  contextWindow?: number;
  /**
   * Section header the composer's shared model list files this entry under
   * (vendor name: Anthropic / OpenAI / xAI). Set client-side when the lists of
   * several engines are merged into one menu; the server never sends it.
   */
  group?: string;
  effort?: {
    default?: string;
    values: {
      value: string;
      description?: string;
    }[];
  };
};

export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
};

export type ProviderModelsCacheInfo = {
  updatedAt: string;
  expiresAt: string;
  source: 'memory' | 'disk' | 'fresh';
};

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'browser' | 'stats' | 'autopilot' | `plugin:${string}`;

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  provider?: LLMProvider;
  __provider?: LLMProvider;
  // This session's own remembered model/thinking-effort choice (`null` until
  // the user picks one while this session is open). Falls back to the
  // account-wide default when absent — see useChatProviderState's hydration
  // effect.
  model?: string | null;
  effort?: string | null;
  // Chat links from the server (relay = continuation, thread): parent and
  // children of this session, see shared/session-links.ts.
  links?: SessionLinks;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

// After the projectName → projectId migration the backend no longer returns a
// folder-derived `name` string. Projects are now addressed everywhere by the
// DB-assigned `projectId` (primary key in the `projects` table), and the UI
// uses the same identifier for routing, state keys and API calls.
export interface Project {
  projectId: string;
  displayName: string;
  fullPath: string;
  path?: string;
  isStarred?: boolean;
  sessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  [key: string]: unknown;
}

export interface LoadingProgress {
  kind?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

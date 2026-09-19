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

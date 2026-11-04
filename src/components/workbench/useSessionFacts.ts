/**
 * What the canvas knows about the open chat, read from what Neo3 already
 * serves — the chat itself is not touched:
 * engine/model/effort (the session row + this browser's effort choice + the
 * provider catalog), context occupancy (`…/token-usage` and live
 * `token_budget` frames), subscription limits (`/api/usage/limits`) and MCP
 * names (`/api/providers/:provider/mcp/servers`, names only), files changed
 * in the last turn (the tail of `/api/providers/sessions/:id/messages`).
 */
import { useEffect, useState } from 'react';

import { useWebSocket } from '../../contexts/WebSocketContext';
import type { ServerEvent } from '../../contexts/WebSocketContext';
import type { ProjectSession, ProviderModelOption, ProviderModelsDefinition } from '../../types/app';
import { authenticatedFetch } from '../../utils/api';
import type { NormalizedMessage } from '../../stores/useSessionStore';
import { normalizedToChatMessages } from '../chat/hooks/useChatMessages';
import { mergeContextBudget } from '../chat/utils/contextBudget';

import { turnFileChanges } from './inspector/inspectorModel';

const TOKEN_USAGE_POLL_MS = 20_000;
const LIMITS_POLL_MS = 60_000;
/** A turn rarely spans more rows; the tail is enough to find its user message. */
const TURN_TAIL_LIMIT = 300;

export type SessionEngine = {
  provider: string | null;
  model: string | null;
  modelLabel: string | null;
  effort: string | null;
  contextWindow: number | null;
};

const catalogs = new Map<string, Promise<ProviderModelsDefinition | null>>();

function loadCatalog(provider: string): Promise<ProviderModelsDefinition | null> {
  let pending = catalogs.get(provider);
  if (!pending) {
    pending = authenticatedFetch(`/api/providers/${encodeURIComponent(provider)}/models`)
      .then(async (response: Response) => {
        if (!response.ok) return null;
        const body = (await response.json()) as { data?: { models?: ProviderModelsDefinition } } | null;
        return body?.data?.models ?? null;
      })
      .catch(() => null);
    catalogs.set(provider, pending);
    // A failed read is retried on the next open, not cached forever.
    void pending.then((catalog) => {
      if (!catalog) catalogs.delete(provider);
    });
  }
  return pending;
}

const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export function sessionProvider(session: ProjectSession | null): string | null {
  return (session?.__provider ?? session?.provider ?? null) || null;
}

export function useSessionEngine(session: ProjectSession | null): SessionEngine {
  const provider = sessionProvider(session);
  const [catalog, setCatalog] = useState<ProviderModelsDefinition | null>(null);

  useEffect(() => {
    setCatalog(null);
    if (!provider) return undefined;
    let cancelled = false;
    void loadCatalog(provider).then((next) => {
      if (!cancelled) setCatalog(next);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const model = (typeof session?.model === 'string' && session.model)
    || (provider ? readLocal(`${provider}-model`) : null)
    || catalog?.DEFAULT
    || null;
  const option: ProviderModelOption | undefined = model ? catalog?.OPTIONS.find((entry) => entry.value === model) : undefined;
  // Same key the composer writes when the effort chip is changed in this chat.
  const chosenEffort = session?.id && provider && model
    ? readLocal(`model-effort:${JSON.stringify([session.id, provider, model])}`)
    : null;
  const effort = chosenEffort || (typeof session?.effort === 'string' && session.effort ? session.effort : null);

  return {
    provider,
    model,
    modelLabel: option?.label ?? model,
    effort,
    contextWindow: typeof option?.contextWindow === 'number' ? option.contextWindow : null,
  };
}

/** Latest token-usage payload of the chat (`used` = context occupancy); null — unknown. */
export function useSessionTokenUsage(projectId: string | null, sessionId: string | null): Record<string, unknown> | null {
  const { subscribe } = useWebSocket();
  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    setUsage(null);
    if (!projectId || !sessionId) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await authenticatedFetch(
          `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/token-usage`,
        );
        if (!cancelled && response.ok) setUsage((await response.json()) as Record<string, unknown>);
      } catch {
        // Keep what is shown.
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, TOKEN_USAGE_POLL_MS);
    const unsubscribe = subscribe((event: ServerEvent) => {
      if (event.kind !== 'status' || event.text !== 'token_budget' || event.sessionId !== sessionId) return;
      const incoming = event.tokenBudget;
      if (incoming && typeof incoming === 'object') {
        setUsage((previous) => mergeContextBudget(previous, incoming as Record<string, unknown>));
      }
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [projectId, sessionId, subscribe]);

  return usage;
}

/** Raw `GET /api/usage/limits` body for the engine; only Claude and Codex report limits. */
export function useUsageLimitsBody(provider: string | null): unknown {
  const [body, setBody] = useState<unknown>(null);

  useEffect(() => {
    setBody(null);
    if (provider !== 'claude' && provider !== 'codex') return undefined;
    let cancelled = false;
    const url = provider === 'codex' ? '/api/usage/limits?provider=codex' : '/api/usage/limits';
    const load = async () => {
      try {
        const response = await authenticatedFetch(url);
        if (!cancelled && response.ok) setBody(await response.json());
      } catch {
        // Keep what is shown.
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, LIMITS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [provider]);

  return body;
}

/** MCP server names configured for the engine in this project; null — not known. */
export function useMcpNames(provider: string | null, projectPath: string | null): string[] | null {
  const [names, setNames] = useState<string[] | null>(null);

  useEffect(() => {
    setNames(null);
    if (!provider) return undefined;
    let cancelled = false;
    const params = new URLSearchParams({ fields: 'names' });
    if (projectPath) params.set('workspacePath', projectPath);
    authenticatedFetch(`/api/providers/${encodeURIComponent(provider)}/mcp/servers?${params.toString()}`)
      .then(async (response: Response) => {
        if (!response.ok) return null;
        const body = (await response.json()) as { data?: { scopes?: Record<string, Array<{ name?: unknown }>> } } | null;
        const scopes = body?.data?.scopes;
        if (!scopes || typeof scopes !== 'object') return null;
        const all = Object.values(scopes).flatMap((servers) => (Array.isArray(servers) ? servers : []));
        return [...new Set(all.map((server) => server?.name).filter((name): name is string => typeof name === 'string' && !!name))];
      })
      .then((next) => {
        if (!cancelled) setNames(next);
      })
      .catch(() => {
        if (!cancelled) setNames(null);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, projectPath]);

  return names;
}

/**
 * Files the agent changed in the chat's last turn; null — not known (new chat,
 * no access, offline). `refreshKey` reloads it (the attention status of the chat
 * changes when a turn starts and ends).
 */
export function useTurnFileChanges(sessionId: string | null, refreshKey: string | null): string[] | null {
  const [files, setFiles] = useState<string[] | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setFiles(null);
      return undefined;
    }
    let cancelled = false;
    const params = new URLSearchParams({ limit: String(TURN_TAIL_LIMIT), offset: '0' });
    authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}/messages?${params.toString()}`)
      .then(async (response: Response) => {
        if (!response.ok) return null;
        const body = (await response.json()) as { data?: { messages?: unknown }; messages?: unknown } | null;
        const messages = body?.data?.messages ?? body?.messages;
        if (!Array.isArray(messages)) return null;
        return turnFileChanges(normalizedToChatMessages(messages as NormalizedMessage[]));
      })
      .then((next) => {
        if (!cancelled) setFiles(next);
      })
      .catch(() => {
        if (!cancelled) setFiles(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  return files;
}

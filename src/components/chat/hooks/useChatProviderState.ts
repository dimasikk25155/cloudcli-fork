import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { defaultClaudeModel } from '../../../utils/instanceConfig';
import { WORK_MODES } from '../types/types';
import type { PendingPermissionRequest, PermissionMode, WorkMode } from '../types/types';
import type {
  ProjectSession,
  LLMProvider,
  Project,
  ProviderModelOption,
  ProviderModelsCacheInfo,
  ProviderModelsDefinition,
} from '../../../types/app';
import {
  DEFAULT_EFFORT_VALUE,
  FALLBACK_PROVIDER_EFFORT_VALUES,
  toProviderEffortOptions,
} from '../constants/providerEffort';
import { preferredStartingMode, skipPermissionsDefaultMode } from '../utils/permissionDefaults';
import { withAutoPlanMode } from '../utils/autoPlanMode';
import {
  IDLE_WORK_MODE,
  idlePermissionMode,
  isIdleComposerModes,
} from '../utils/composerModeReset';
import {
  WORK_MODE_DEFAULT_KEY,
  readDefaultWorkMode,
  readSessionWorkMode,
  workModeStorageKey,
} from '../utils/workModeStorage';
import { applyProviderModel, type ProviderModelSetters } from '../utils/providerModelState';
import { COMPOSER_DRAFT_EVENT, type ComposerDraftDetail } from '../../../utils/composerDraft';

const FALLBACK_DEFAULT_MODEL: Record<LLMProvider, string> = {
  // 'default' means "whatever the CLI is configured to use" and stays the
  // answer everywhere the optional VITE_DEFAULT_CLAUDE_MODEL is unset (the
  // production VPS). The laptop instance sets it to a local model so a new
  // chat opens on that instead of walking through the picker. A model picked
  // inside a chat is stored per provider in localStorage and still wins.
  claude: defaultClaudeModel('default'),
  cursor: 'gpt-5.3-codex',
  codex: 'gpt-5.6-sol',
  opencode: 'anthropic/claude-sonnet-4-5',
  kimi: 'kimi-code/k3',
  gemini: 'gemini-2.5-pro',
  // Grok's picker lists modes, not model ids (grok.com-style): the preset is
  // expanded into `-m` + `--reasoning-effort` server-side. Naming a raw model
  // here would open a new chat on an entry the picker no longer shows.
  grok: 'grok-mode-build',
};

// Kimi re-added 2026-07-26 — including it here re-enables `loadProviderModels`
// below to fetch/populate providerModelCatalog.kimi, so the model dropdown and
// the new-chat picker show Kimi again. Login/usage is the user's own account.
// 'gemini' intentionally excluded — Google killed free personal-account login
// for Gemini CLI/Code Assist on 2026-06-18 (live test: OAuth token obtained,
// but Code Assist itself rejects with "no longer supported ... migrate to
// Antigravity"). Excluding it here also stops loadProviderModels from
// fetching providerModelCatalog.gemini. Re-add once there's a real login path.
// 'grok' added 2026-08-21 — xAI's Grok Build CLI, logged in through the
// SuperGrok subscription (`grok login --device-auth` → ~/.grok/auth.json).
const PROVIDERS: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode', 'kimi', 'grok'];

/**
 * Settings-owned "engine every new chat opens on". Cached in localStorage from
 * the account preferences (`/api/settings/provider-preferences`) so first
 * paint doesn't wait for the request; the server value refreshes the cache on
 * every load. Empty/absent means the historic behaviour: a new chat sticks to
 * whatever engine was used last (`selected-provider`).
 */
export const DEFAULT_CHAT_PROVIDER_KEY = 'default-chat-provider';

export const readDefaultChatProvider = (): LLMProvider | null => {
  const preferred = localStorage.getItem(DEFAULT_CHAT_PROVIDER_KEY);
  return PROVIDERS.includes(preferred as LLMProvider) ? preferred as LLMProvider : null;
};

const readStoredProvider = (): LLMProvider => {
  // A page opened fresh (no session in the URL yet) is a "new chat", so the
  // Settings default wins over the last-used engine when it is set.
  const preferred = readDefaultChatProvider();
  if (preferred) {
    return preferred;
  }
  const storedProvider = localStorage.getItem('selected-provider');
  return PROVIDERS.includes(storedProvider as LLMProvider)
    ? storedProvider as LLMProvider
    : 'grok';
};

/**
 * Fallback permission-mode matrix used only until the backend capability
 * matrix (`GET /api/providers/capabilities`) has loaded. The backend is the
 * source of truth; this mirror exists so the composer renders sensibly on
 * first paint and when the capabilities request fails.
 */
const FALLBACK_PERMISSION_MODES: Record<LLMProvider, PermissionMode[]> = {
  claude: ['default', 'bypassPermissions', 'plan'],
  cursor: ['default', 'bypassPermissions', 'plan'],
  // No plan mode: the Codex CLI has no read-only agent to map it onto.
  codex: ['default', 'bypassPermissions'],
  opencode: ['default', 'bypassPermissions', 'plan'],
  // Headless `kimi -p` is always fully autonomous; there is no mode to pick.
  kimi: ['default'],
  // Gemini's own interactive `default` prompts for approval, which would
  // stall a headless run — the runner maps this onto `--approval-mode
  // auto_edit`. See resolveGeminiApprovalMode in server/gemini-cli.js.
  gemini: ['default', 'bypassPermissions', 'plan'],
  // Grok maps `default` onto `--permission-mode auto` (the only non-bypass
  // mode that finishes headless) and keeps `plan` read-only.
  // See resolveGrokPermissionMode in server/grok-cli.js.
  grok: ['default', 'bypassPermissions', 'plan'],
};

type ProviderCapabilities = {
  provider: LLMProvider;
  permissionModes: string[];
  defaultPermissionMode: string;
  supportsImages: boolean;
  supportsAbort: boolean;
  supportsPermissionRequests: boolean;
  supportsTokenUsage: boolean;
  supportsEffort?: boolean;
  supportsWorkMode?: boolean;
};

type ProviderCapabilitiesApiResponse = {
  success?: boolean;
  data?: {
    providers?: ProviderCapabilities[];
  };
};

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
  selectedProject: Project | null;
}

type ProviderModelsApiResponse = {
  success?: boolean;
  data?: {
    models?: ProviderModelsDefinition;
    cache?: ProviderModelsCacheInfo;
  };
};

type ChangeActiveModelApiResponse = {
  success?: boolean;
  data?: {
    provider?: LLMProvider;
    sessionId?: string;
    supported?: boolean;
    changed?: boolean;
    model?: string | null;
  };
};

type ChangeActiveEffortApiResponse = {
  success?: boolean;
  data?: {
    provider?: LLMProvider;
    sessionId?: string;
    supported?: boolean;
    changed?: boolean;
    effort?: string | null;
  };
};

export function useChatProviderState({ selectedSession, selectedProject: _selectedProject }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  // Per chat, exactly like permissionMode: one conversation can run on
  // briefings while another is left to get on with it. New chats start from
  // the account default set in Settings (WORK_MODE_DEFAULT_KEY).
  const [workMode, setWorkMode] = useState<WorkMode>(readDefaultWorkMode);
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setProvider] = useState<LLMProvider>(readStoredProvider);
  const [cursorModel, setCursorModel] = useState<string>(() => {
    return localStorage.getItem('cursor-model') || FALLBACK_DEFAULT_MODEL.cursor;
  });
  const [claudeModel, setClaudeModel] = useState<string>(() => {
    return localStorage.getItem('claude-model') || FALLBACK_DEFAULT_MODEL.claude;
  });
  const [codexModel, setCodexModel] = useState<string>(() => {
    return localStorage.getItem('codex-model') || FALLBACK_DEFAULT_MODEL.codex;
  });
  const [providerEfforts, setProviderEfforts] = useState<Partial<Record<LLMProvider, string>>>(() => {
    return PROVIDERS.reduce<Partial<Record<LLMProvider, string>>>((acc, targetProvider) => {
      acc[targetProvider] = localStorage.getItem(`${targetProvider}-effort`) || DEFAULT_EFFORT_VALUE;
      return acc;
    }, {});
  });
  const [opencodeModel, setOpenCodeModel] = useState<string>(() => {
    return localStorage.getItem('opencode-model') || FALLBACK_DEFAULT_MODEL.opencode;
  });
  const [kimiModel, setKimiModel] = useState<string>(() => {
    return localStorage.getItem('kimi-model') || FALLBACK_DEFAULT_MODEL.kimi;
  });
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    return localStorage.getItem('gemini-model') || FALLBACK_DEFAULT_MODEL.gemini;
  });
  const [grokModel, setGrokModel] = useState<string>(() => {
    return localStorage.getItem('grok-model') || FALLBACK_DEFAULT_MODEL.grok;
  });

  /**
   * Backend-owned capability matrix keyed by provider. Drives the permission
   * mode picker (and is the extension point for future per-provider UI
   * differences) so the frontend stays free of hardcoded provider branching.
   * Null until `/api/providers/capabilities` resolves; the static fallback
   * map covers that window.
   */
  const [providerCapabilities, setProviderCapabilities] = useState<
    Partial<Record<LLMProvider, ProviderCapabilities>> | null
  >(null);

  const [providerModelCatalog, setProviderModelCatalog] = useState<
    Partial<Record<LLMProvider, ProviderModelsDefinition>>
  >({});
  const [providerModelCacheCatalog, setProviderModelCacheCatalog] = useState<
    Partial<Record<LLMProvider, ProviderModelsCacheInfo>>
  >({});
  const [providerModelsLoading, setProviderModelsLoading] = useState(true);
  const [providerModelsRefreshing, setProviderModelsRefreshing] = useState(false);

  const providerModelsRequestIdRef = useRef(0);

  // Local mirror of session-scoped model/effort writes, keyed by session id.
  // `selectedSession` comes from the sidebar's already-fetched project list,
  // which isn't refetched after a POST to active-model/active-effort — so
  // right after picking a model, switching away and back would read the
  // stale (pre-change) value off `selectedSession` and fall back to the
  // global default. This ref is the source of truth for "what did *this*
  // browser session just set", checked before `selectedSession.model/.effort`
  // in the hydration effect below. Survives session switches because this
  // hook isn't remounted when `selectedSession` changes (no key prop upstream).
  const sessionOverridesRef = useRef<Record<string, { model?: string; effort?: string }>>({});

  // Readable from inside promise callbacks that must not re-run per session
  // (the account-defaults fetch below), where `selectedSession` would be the
  // stale value captured when the request started.
  const selectedSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedSessionIdRef.current = selectedSession?.id ?? null;
  }, [selectedSession?.id]);

  // Fire-and-forget: push the new default to the account so every other
  // device (phone, another Mac session) picks it up on its next load. Local
  // state/localStorage above already made the change feel instant on this
  // device; a failed sync just means other devices stay on the old value
  // until it succeeds again, never blocks or reverts this one.
  const syncProviderModelToServer = useCallback((targetProvider: LLMProvider, model: string) => {
    authenticatedFetch('/api/settings/provider-preferences/model', {
      method: 'PUT',
      body: JSON.stringify({ provider: targetProvider, model }),
    }).catch((error) => {
      console.warn('Failed to sync default model to account:', error);
    });
  }, []);

  const syncProviderEffortToServer = useCallback((targetProvider: LLMProvider, effort: string) => {
    authenticatedFetch('/api/settings/provider-preferences/effort', {
      method: 'PUT',
      body: JSON.stringify({ provider: targetProvider, effort }),
    }).catch((error) => {
      console.warn('Failed to sync default effort to account:', error);
    });
  }, []);

  const providerModelSetters = useMemo<ProviderModelSetters>(() => ({
    claude: setClaudeModel,
    cursor: setCursorModel,
    codex: setCodexModel,
    opencode: setOpenCodeModel,
    kimi: setKimiModel,
    gemini: setGeminiModel,
    grok: setGrokModel,
  }), []);

  /**
   * Points the composer's Model chip at a value for the CURRENT chat only —
   * React state, nothing else. What a brand-new chat starts with is a separate
   * setting (setStoredProviderModel, written from Settings), so experimenting
   * with a cheaper model inside one conversation no longer silently reprograms
   * every future one. The value is persisted against the session row by
   * selectProviderModel / commitSessionModelAndEffort.
   */
  const setActiveProviderModel = useCallback((targetProvider: LLMProvider, model: string) => {
    applyProviderModel(targetProvider, model, providerModelSetters);
  }, [providerModelSetters]);

  const setActiveProviderEffort = useCallback((targetProvider: LLMProvider, effort: string) => {
    setProviderEfforts((previous) => (
      previous[targetProvider] === effort ? previous : { ...previous, [targetProvider]: effort }
    ));
  }, []);

  /**
   * Sets the default every NEW chat starts with (Settings-only writer).
   * A chat already open keeps whatever it was started with — only a
   * not-yet-created one follows the new default immediately.
   */
  const setStoredProviderModel = useCallback((targetProvider: LLMProvider, model: string) => {
    localStorage.setItem(`${targetProvider}-model`, model);
    syncProviderModelToServer(targetProvider, model);
    if (!selectedSession?.id) {
      setActiveProviderModel(targetProvider, model);
    }
  }, [selectedSession?.id, setActiveProviderModel, syncProviderModelToServer]);

  // Account-wide new-chat defaults, loaded once on mount and applied on top of
  // whatever localStorage had (server is the cross-device source of truth;
  // localStorage is just this browser's instant-paint cache).
  //
  // The stored values are ALWAYS refreshed, but they only touch the composer's
  // live state when no chat is open: a conversation already running on its own
  // model must not be yanked onto the account default by a request that
  // happens to resolve a second after the page loaded.
  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/settings/provider-preferences')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: {
        models?: Record<string, string>;
        efforts?: Record<string, string>;
        workMode?: string | null;
        defaultProvider?: string | null;
      } | null) => {
        if (cancelled || !data) {
          return;
        }
        const hasOpenSession = Boolean(selectedSessionIdRef.current);
        // Cache the new-chat engine for readStoredProvider / the new-chat
        // button. Applied on the next "new chat", deliberately not to the
        // current draft — a provider picked by hand must not snap back.
        if (data.defaultProvider && PROVIDERS.includes(data.defaultProvider as LLMProvider)) {
          localStorage.setItem(DEFAULT_CHAT_PROVIDER_KEY, data.defaultProvider);
        } else if (data.defaultProvider === null) {
          localStorage.removeItem(DEFAULT_CHAT_PROVIDER_KEY);
        }
        if (data.workMode && WORK_MODES.includes(data.workMode as WorkMode)) {
          localStorage.setItem(WORK_MODE_DEFAULT_KEY, data.workMode);
          // Same rule as the model above: an open chat keeps its own mode,
          // only a chat that has not started yet follows the fresh default.
          if (!hasOpenSession && !draftWorkModePickedRef.current) {
            setWorkMode(data.workMode as WorkMode);
          }
        }
        for (const targetProvider of PROVIDERS) {
          const model = data.models?.[targetProvider];
          if (model) {
            localStorage.setItem(`${targetProvider}-model`, model);
            if (!hasOpenSession) {
              setActiveProviderModel(targetProvider, model);
            }
          }
          const effort = data.efforts?.[targetProvider];
          if (effort) {
            localStorage.setItem(`${targetProvider}-effort`, effort);
          }
        }
        if (data.efforts && !hasOpenSession) {
          setProviderEfforts((previous) => ({ ...previous, ...data.efforts }));
        }
      })
      .catch((error) => {
        console.warn('Failed to load account provider preferences:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [setActiveProviderModel]);

  /** Mirrors setStoredProviderModel for the thinking level. */
  const setStoredProviderEffort = useCallback((targetProvider: LLMProvider, effort: string) => {
    localStorage.setItem(`${targetProvider}-effort`, effort);
    syncProviderEffortToServer(targetProvider, effort);
    if (!selectedSession?.id) {
      setActiveProviderEffort(targetProvider, effort);
    }
  }, [selectedSession?.id, setActiveProviderEffort, syncProviderEffortToServer]);

  const loadProviderModels = useCallback(async (options: { bypassCache?: boolean } = {}) => {
    const requestId = providerModelsRequestIdRef.current + 1;
    providerModelsRequestIdRef.current = requestId;
    const isHardRefresh = options.bypassCache === true;

    if (isHardRefresh) {
      setProviderModelsRefreshing(true);
    } else {
      setProviderModelsLoading(true);
    }

    try {
      const results = await Promise.all(
        PROVIDERS.map(async (p) => {
          const params = new URLSearchParams();
          if (options.bypassCache) {
            params.set('bypassCache', 'true');
          }

          const queryString = params.toString();
          const response = await authenticatedFetch(`/api/providers/${p}/models${queryString ? `?${queryString}` : ''}`);
          const body = (await response.json()) as ProviderModelsApiResponse;
          if (!body.success || !body.data?.models || !body.data?.cache) {
            return null;
          }

          return body.data;
        }),
      );

      if (providerModelsRequestIdRef.current !== requestId) {
        return;
      }

      const nextCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>> = {};
      const nextCacheCatalog: Partial<Record<LLMProvider, ProviderModelsCacheInfo>> = {};

      PROVIDERS.forEach((p, i) => {
        const entry = results[i];
        if (!entry) {
          return;
        }

        nextCatalog[p] = entry.models;
        nextCacheCatalog[p] = entry.cache;
      });

      setProviderModelCatalog(nextCatalog);
      setProviderModelCacheCatalog(nextCacheCatalog);
    } catch (error) {
      console.error('Error loading provider models:', error);
    } finally {
      if (providerModelsRequestIdRef.current === requestId) {
        setProviderModelsLoading(false);
        setProviderModelsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadProviderModels();
  }, [loadProviderModels]);

  useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      try {
        const response = await authenticatedFetch('/api/providers/capabilities');
        const body = (await response.json()) as ProviderCapabilitiesApiResponse;
        if (cancelled || !body.success || !Array.isArray(body.data?.providers)) {
          return;
        }

        const byProvider: Partial<Record<LLMProvider, ProviderCapabilities>> = {};
        for (const capabilities of body.data.providers) {
          byProvider[capabilities.provider] = capabilities;
        }
        setProviderCapabilities(byProvider);
      } catch (error) {
        console.error('Error loading provider capabilities:', error);
      }
    };

    void loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, []);

  // The backend catalog lists what the ENGINE can do; the auto-plan mode is
  // added on top of it here because it is a client-side composition of two of
  // those modes (plan, then bypass) rather than a mode the engine knows.
  const getPermissionModesForProvider = useCallback((targetProvider: LLMProvider): PermissionMode[] => {
    const capabilityModes = providerCapabilities?.[targetProvider]?.permissionModes;
    if (capabilityModes && capabilityModes.length > 0) {
      return withAutoPlanMode(capabilityModes as PermissionMode[]);
    }
    return withAutoPlanMode(FALLBACK_PERMISSION_MODES[targetProvider] ?? ['default']);
  }, [providerCapabilities]);

  const getDefaultPermissionModeForProvider = useCallback((targetProvider: LLMProvider): PermissionMode => {
    const modes = getPermissionModesForProvider(targetProvider);
    // Global "skip permissions" switch, if on, decides the starting mode.
    const skipDefault = skipPermissionsDefaultMode(targetProvider, modes);
    if (skipDefault) {
      return skipDefault;
    }
    // Instance-wide preference: a new chat opens in bypass whenever the engine
    // has it, because the owner asked for work to run without being pinged
    // (11.08.2026). Deliberately NOT the Settings switch above — that one lives
    // in a single browser's localStorage, so phone and laptop disagreed. A mode
    // picked inside a chat still wins and is remembered per chat.
    const preferred = preferredStartingMode(modes);
    if (preferred) {
      return preferred;
    }
    const capabilityDefault = providerCapabilities?.[targetProvider]?.defaultPermissionMode as PermissionMode | undefined;
    if (capabilityDefault && modes.includes(capabilityDefault)) {
      return capabilityDefault;
    }
    return modes[0] ?? 'default';
  }, [getPermissionModesForProvider, providerCapabilities]);

  const getSupportsEffortForProvider = useCallback((targetProvider: LLMProvider): boolean => {
    const capabilitySupport = providerCapabilities?.[targetProvider]?.supportsEffort;
    if (typeof capabilitySupport === 'boolean') {
      return capabilitySupport;
    }
    return Boolean(FALLBACK_PROVIDER_EFFORT_VALUES[targetProvider]?.length);
  }, [providerCapabilities]);

  // `current` (React state) must win over `storageKey` (the new-chat default)
  // whenever both are valid: `current` is what the hydration effect below just
  // set for this session, and re-reading localStorage first would silently
  // snap it back to the default on every render — exactly the bug that made
  // per-session model memory look like it "didn't stick".
  // localStorage is only a fallback for the cases this function actually
  // exists for: first paint before `current` is set, or `current` holding a
  // model the catalog no longer lists.
  //
  // The reconcile effects below deliberately do NOT write back to localStorage:
  // that key is the "what new chats start with" setting owned by Settings, and
  // mirroring a session's own model into it is what used to turn every
  // in-chat model pick into a global default.
  const pickStoredOrCurrent = (
    storageKey: string,
    current: string,
    def: ProviderModelsDefinition,
  ): string => {
    if (current && def.OPTIONS.some((o) => o.value === current)) {
      return current;
    }
    const stored = localStorage.getItem(storageKey);
    if (stored && def.OPTIONS.some((o) => o.value === stored)) {
      return stored;
    }
    return def.DEFAULT;
  };

  const getModelOption = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): ProviderModelOption | null => {
    const definition = providerModelCatalog[targetProvider];
    if (!definition) {
      return null;
    }

    return definition.OPTIONS.find((option) => option.value === model) ?? null;
  }, [providerModelCatalog]);

  const supportsWorkModeForProvider = useCallback((targetProvider: LLMProvider): boolean => {
    const capabilitySupport = providerCapabilities?.[targetProvider]?.supportsWorkMode;
    if (typeof capabilitySupport === 'boolean') {
      return capabilitySupport;
    }
    // Before the matrix lands (first paint) fall back to engines that actually
    // carry work modes. Grok's backend sets supportsWorkMode: true; without
    // this the chip is missing on the first frame of a new Grok chat.
    return targetProvider === 'claude' || targetProvider === 'grok';
  }, [providerCapabilities]);

  const getEffortOptionsForModel = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): NonNullable<ProviderModelOption['effort']>['values'] => {
    if (!getSupportsEffortForProvider(targetProvider)) {
      return [];
    }

    const option = getModelOption(targetProvider, model);
    if (option) {
      return option.effort?.values ?? [];
    }

    return toProviderEffortOptions(FALLBACK_PROVIDER_EFFORT_VALUES[targetProvider] ?? []);
  }, [getModelOption, getSupportsEffortForProvider]);

  const getAllowedEffortValues = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): string[] => (
    getEffortOptionsForModel(targetProvider, model).map((value) => value.value)
  ), [getEffortOptionsForModel]);

  const reconcileStoredEffort = useCallback((
    targetProvider: LLMProvider,
    model: string,
    currentEffort: string,
  ): string => {
    const allowedValues = getAllowedEffortValues(targetProvider, model);
    if (allowedValues.length === 0) {
      return DEFAULT_EFFORT_VALUE;
    }

    if (currentEffort === DEFAULT_EFFORT_VALUE || !currentEffort) {
      return DEFAULT_EFFORT_VALUE;
    }

    if (allowedValues.includes(currentEffort)) {
      return currentEffort;
    }

    return DEFAULT_EFFORT_VALUE;
  }, [getAllowedEffortValues]);

  const providerModels = useMemo<Record<LLMProvider, string>>(() => ({
    claude: claudeModel,
    cursor: cursorModel,
    codex: codexModel,
    opencode: opencodeModel,
    kimi: kimiModel,
    gemini: geminiModel,
    grok: grokModel,
  }), [claudeModel, cursorModel, codexModel, opencodeModel, kimiModel, geminiModel, grokModel]);

  useEffect(() => {
    const claude = providerModelCatalog.claude;
    if (claude) {
      const next = pickStoredOrCurrent('claude-model', claudeModel, claude);
      if (next !== claudeModel) {
        setClaudeModel(next);
      }
    }
  }, [providerModelCatalog.claude, claudeModel]);

  useEffect(() => {
    const cursor = providerModelCatalog.cursor;
    if (cursor) {
      const next = pickStoredOrCurrent('cursor-model', cursorModel, cursor);
      if (next !== cursorModel) {
        setCursorModel(next);
      }
    }
  }, [providerModelCatalog.cursor, cursorModel]);

  useEffect(() => {
    const codex = providerModelCatalog.codex;
    if (codex) {
      const next = pickStoredOrCurrent('codex-model', codexModel, codex);
      if (next !== codexModel) {
        setCodexModel(next);
      }
    }
  }, [providerModelCatalog.codex, codexModel]);

  useEffect(() => {
    const opencode = providerModelCatalog.opencode;
    if (opencode) {
      const next = pickStoredOrCurrent('opencode-model', opencodeModel, opencode);
      if (next !== opencodeModel) {
        setOpenCodeModel(next);
      }
    }
  }, [providerModelCatalog.opencode, opencodeModel]);

  useEffect(() => {
    const kimi = providerModelCatalog.kimi;
    if (kimi) {
      const next = pickStoredOrCurrent('kimi-model', kimiModel, kimi);
      if (next !== kimiModel) {
        setKimiModel(next);
      }
    }
  }, [providerModelCatalog.kimi, kimiModel]);

  useEffect(() => {
    const gemini = providerModelCatalog.gemini;
    if (gemini) {
      const next = pickStoredOrCurrent('gemini-model', geminiModel, gemini);
      if (next !== geminiModel) {
        setGeminiModel(next);
      }
    }
  }, [providerModelCatalog.gemini, geminiModel]);

  useEffect(() => {
    const grok = providerModelCatalog.grok;
    if (grok) {
      const next = pickStoredOrCurrent('grok-model', grokModel, grok);
      if (next !== grokModel) {
        setGrokModel(next);
      }
    }
  }, [providerModelCatalog.grok, grokModel]);

  useEffect(() => {
    const nextEfforts: Partial<Record<LLMProvider, string>> = {};
    let hasUpdates = false;

    for (const targetProvider of PROVIDERS) {
      const currentEffort = providerEfforts[targetProvider] ?? DEFAULT_EFFORT_VALUE;
      const nextEffort = reconcileStoredEffort(targetProvider, providerModels[targetProvider], currentEffort);
      if (nextEffort === currentEffort) {
        continue;
      }

      nextEfforts[targetProvider] = nextEffort;
      hasUpdates = true;
    }

    if (hasUpdates) {
      setProviderEfforts((previous) => ({ ...previous, ...nextEfforts }));
    }
  }, [providerEfforts, providerModels, reconcileStoredEffort]);

  // Guards the "no session yet" branch below from clobbering a mode the user
  // just picked for an in-progress draft when getDefaultPermissionModeForProvider
  // changes identity a moment later (e.g. GET /api/providers/capabilities
  // resolving after mount, slower over a phone connection) — without this, a
  // mode picked right after opening a brand-new chat could silently snap
  // back to the default before the first send. Rearmed on every real
  // identity change (new draft, switched to a different chat, or switched
  // provider); a background re-render of the callbacks alone does not touch it.
  const draftPermissionModePickedRef = useRef(false);
  useEffect(() => {
    draftPermissionModePickedRef.current = false;
  }, [selectedSession?.id, provider]);

  useEffect(() => {
    const validModes = getPermissionModesForProvider(provider);

    if (selectedSession?.id) {
      // Every session's mode lives ONLY under its own key — no fallback to
      // any other chat's choice, so a mode picked in one conversation can
      // never leak into another that simply never set its own.
      const sessionSavedMode = localStorage.getItem(`permissionMode-${selectedSession.id}`) as PermissionMode | null;
      setPermissionMode(
        sessionSavedMode && validModes.includes(sessionSavedMode)
          ? sessionSavedMode
          : getDefaultPermissionModeForProvider(provider),
      );
      return;
    }

    if (draftPermissionModePickedRef.current) {
      // User already picked a mode for this in-progress, not-yet-sent draft
      // — leave it alone. It becomes this chat's own permanent record the
      // moment it gets a real id (see commitPermissionModeToSession, called
      // from ChatInterface's onSessionEstablished).
      return;
    }

    setPermissionMode(getDefaultPermissionModeForProvider(provider));
  }, [selectedSession?.id, provider, getDefaultPermissionModeForProvider, getPermissionModesForProvider]);

  // Same shape for the work mode, minus the provider dimension: it is stored
  // per chat and falls back to the account default, never to another chat's
  // choice. Not keyed on `provider` because the mode describes how the user
  // wants to be talked to, not what the engine can do.
  const draftWorkModePickedRef = useRef(false);
  useEffect(() => {
    draftWorkModePickedRef.current = false;
  }, [selectedSession?.id]);

  useEffect(() => {
    if (selectedSession?.id) {
      setWorkMode(readSessionWorkMode(selectedSession.id));
      return;
    }

    if (draftWorkModePickedRef.current) {
      return;
    }

    setWorkMode(readDefaultWorkMode());
  }, [selectedSession?.id]);

  // Mirrors the permissionMode effect above: a session with its own saved
  // model/effort shows that; a session with none (or a brand-new chat) falls
  // back to this provider's last-used default, so switching between chats
  // moves the composer's Model/Level buttons with it instead of leaving them
  // on whatever the previous chat happened to leave in place. Any invalid
  // leftover value (e.g. a since-removed model) self-corrects via the
  // pickStoredOrCurrent/reconcileStoredEffort effects above on the next render.
  useEffect(() => {
    const localOverride = selectedSession?.id ? sessionOverridesRef.current[selectedSession.id] : undefined;

    const sessionModel = localOverride?.model
      ?? (typeof selectedSession?.model === 'string' && selectedSession.model ? selectedSession.model : null);
    const sessionEffort = localOverride?.effort
      ?? (typeof selectedSession?.effort === 'string' && selectedSession.effort ? selectedSession.effort : null);

    const nextModel = sessionModel
      ?? localStorage.getItem(`${provider}-model`)
      ?? FALLBACK_DEFAULT_MODEL[provider];
    const nextEffort = sessionEffort
      ?? localStorage.getItem(`${provider}-effort`)
      ?? DEFAULT_EFFORT_VALUE;

    applyProviderModel(provider, nextModel, providerModelSetters);

    setProviderEfforts((previous) => (
      previous[provider] === nextEffort ? previous : { ...previous, [provider]: nextEffort }
    ));
  }, [selectedSession?.id, selectedSession?.model, selectedSession?.effort, provider, providerModelSetters]);

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }

    setProvider(selectedSession.__provider);
    localStorage.setItem('selected-provider', selectedSession.__provider);
  }, [provider, selectedSession]);

  // Permission prompts belong to a session, not to the transient provider
  // selection that is synchronized after navigation.
  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  useEffect(() => {
    if (provider !== 'cursor') {
      return;
    }

    authenticatedFetch('/api/cursor/config')
      .then((response) => response.json())
      .then((data) => {
        if (!data.success || !data.config?.model?.modelId) {
          return;
        }

        const modelId = data.config.model.modelId as string;
        if (!localStorage.getItem('cursor-model')) {
          setCursorModel(modelId);
        }
      })
      .catch((error) => {
        console.error('Error loading Cursor config:', error);
      });
  }, [provider]);

  const selectPermissionMode = useCallback((nextMode: PermissionMode) => {
    setPermissionMode(nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    } else {
      // No real session yet (composing a brand-new, unsent chat) — nothing
      // to key a per-chat record on yet. Just mark that this draft has its
      // own deliberate pick (see draftPermissionModePickedRef above); the
      // value itself lives only in `permissionMode` state until it gets
      // written to this chat's own key by commitPermissionModeToSession.
      draftPermissionModePickedRef.current = true;
    }
  }, [selectedSession?.id]);

  // Work mode and permission mode are separate axes, but two of the nine
  // combinations defeat themselves: an "autopilot" run that stops at every
  // permission prompt never finishes unattended, and a "confirm everything"
  // run that silently bypasses prompts contradicts its own point. So picking
  // a work mode also moves the permission chip — visibly, and only from the
  // opposite extreme, so a deliberate combination is never overwritten.
  const selectWorkMode = useCallback((nextMode: WorkMode) => {
    setWorkMode(nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(workModeStorageKey(selectedSession.id), nextMode);
    } else {
      // Draft chat: the pick lives in state until commitWorkModeToSession
      // writes it against the real id (mirrors the permission-mode draft ref).
      draftWorkModePickedRef.current = true;
    }

    const modes = getPermissionModesForProvider(provider);
    if (nextMode === 'autopilot' && permissionMode === 'default' && modes.includes('bypassPermissions')) {
      selectPermissionMode('bypassPermissions');
      return;
    }
    if (nextMode === 'interrogate' && permissionMode === 'bypassPermissions' && modes.includes('default')) {
      selectPermissionMode('default');
    }
  }, [getPermissionModesForProvider, permissionMode, provider, selectedSession?.id, selectPermissionMode]);

  // Catalog briefs (empty-chat job buttons) put text in the composer AND
  // switch this chat to interrogate, so the first move is questions, not a draft.
  useEffect(() => {
    const onDraft = (event: Event) => {
      const mode = (event as CustomEvent<ComposerDraftDetail>).detail?.workMode;
      if (!mode || !WORK_MODES.includes(mode)) {
        return;
      }
      selectWorkMode(mode);
    };
    window.addEventListener(COMPOSER_DRAFT_EVENT, onDraft);
    return () => window.removeEventListener(COMPOSER_DRAFT_EVENT, onDraft);
  }, [selectWorkMode]);

  // Called once, exactly when a brand-new chat's session id becomes real
  // (see ChatInterface's onSessionEstablished). Whatever mode is active
  // RIGHT NOW becomes this session's record for the first send — the only
  // way a mode picked before the first send survives the "no id" -> "real
  // id" jump. The send path then one-shot-resets it to ordinary + bypass.
  const commitPermissionModeToSession = useCallback((sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }
    localStorage.setItem(`permissionMode-${normalizedSessionId}`, permissionMode);
  }, [permissionMode]);

  /** Twin of commitPermissionModeToSession for the work mode. */
  const commitWorkModeToSession = useCallback((sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }
    localStorage.setItem(workModeStorageKey(normalizedSessionId), workMode);
  }, [workMode]);

  /**
   * One-shot modes: the message that just went out keeps the chip that was
   * on, and the composer snaps back to ordinary + bypass so the NEXT
   * message does not write another plan / re-ask the briefing questions /
   * re-invoke the autopilot skill. Pass the session id from the send path
   * — a brand-new chat has no selectedSession.id yet when this runs.
   */
  const resetComposerModesAfterSend = useCallback((sessionId?: string | null) => {
    const modes = getPermissionModesForProvider(provider);
    const idlePerm = idlePermissionMode(modes);
    if (isIdleComposerModes(workMode, permissionMode, modes)) {
      return;
    }

    setWorkMode(IDLE_WORK_MODE);
    setPermissionMode(idlePerm);

    const targetId = (typeof sessionId === 'string' && sessionId.trim()) || selectedSession?.id || '';
    if (targetId) {
      localStorage.setItem(workModeStorageKey(targetId), IDLE_WORK_MODE);
      localStorage.setItem(`permissionMode-${targetId}`, idlePerm);
      return;
    }

    draftWorkModePickedRef.current = true;
    draftPermissionModePickedRef.current = true;
  }, [getPermissionModesForProvider, permissionMode, provider, selectedSession?.id, workMode]);

  const cyclePermissionMode = useCallback(() => {
    const modes = getPermissionModesForProvider(provider);

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    selectPermissionMode(modes[nextIndex]);
  }, [permissionMode, provider, getPermissionModesForProvider, selectPermissionMode]);

  const resolvePermissionModeForProvider = useCallback((
    targetProvider: LLMProvider,
    requestedMode: PermissionMode | string,
  ): PermissionMode => {
    const validModes = getPermissionModesForProvider(targetProvider);
    return validModes.includes(requestedMode as PermissionMode)
      ? requestedMode as PermissionMode
      : getDefaultPermissionModeForProvider(targetProvider);
  }, [getDefaultPermissionModeForProvider, getPermissionModesForProvider]);

  const selectProviderModel = useCallback(async (
    targetProvider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      // Brand-new chat with no id yet: the pick lives in state until
      // commitSessionModelAndEffort writes it against the real session id.
      setActiveProviderModel(targetProvider, model);
      return {
        scope: 'default' as const,
        changed: false,
        model,
      };
    }

    const response = await authenticatedFetch(
      `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/active-model`,
      {
        method: 'POST',
        body: JSON.stringify({ model }),
      },
    );

    const body = (await response.json()) as ChangeActiveModelApiResponse;
    if (!response.ok || !body.success || !body.data?.supported) {
      throw new Error('Unable to change the active model for this session.');
    }

    const resolvedModel = body.data.model || model;
    // Session-scoped on purpose (reversal of the earlier "one global switch"
    // behaviour, 2026-08-07): the chip moves this chat only. The starting
    // point for new chats is set in Settings and stays put.
    setActiveProviderModel(targetProvider, resolvedModel);
    sessionOverridesRef.current[normalizedSessionId] = {
      ...sessionOverridesRef.current[normalizedSessionId],
      model: resolvedModel,
    };

    return {
      scope: 'session' as const,
      changed: body.data.changed === true,
      model: resolvedModel,
    };
  }, [setActiveProviderModel]);

  const selectProviderEffort = useCallback(async (
    targetProvider: LLMProvider,
    effort: string,
    sessionId?: string | null,
  ) => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      setActiveProviderEffort(targetProvider, effort);
      return {
        scope: 'default' as const,
        changed: false,
        effort,
      };
    }

    const response = await authenticatedFetch(
      `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/active-effort`,
      {
        method: 'POST',
        body: JSON.stringify({ effort }),
      },
    );

    const body = (await response.json()) as ChangeActiveEffortApiResponse;
    if (!response.ok || !body.success || !body.data?.supported) {
      throw new Error('Unable to change the active effort for this session.');
    }

    const resolvedEffort = body.data.effort || effort;
    // Session-scoped, mirroring selectProviderModel above.
    setActiveProviderEffort(targetProvider, resolvedEffort);
    sessionOverridesRef.current[normalizedSessionId] = {
      ...sessionOverridesRef.current[normalizedSessionId],
      effort: resolvedEffort,
    };

    return {
      scope: 'session' as const,
      changed: body.data.changed === true,
      effort: resolvedEffort,
    };
  }, [setActiveProviderEffort]);

  const currentProviderEffortOptions = useMemo(() => {
    return getEffortOptionsForModel(provider, providerModels[provider]);
  }, [getEffortOptionsForModel, provider, providerModels]);
  const currentProviderEffort = useMemo(() => {
    return reconcileStoredEffort(
      provider,
      providerModels[provider],
      providerEfforts[provider] ?? DEFAULT_EFFORT_VALUE,
    );
  }, [provider, providerEfforts, providerModels, reconcileStoredEffort]);

  // Twin of commitPermissionModeToSession: a chat composed before it had an id
  // (model and level picked on the empty screen) records those choices against
  // the real session the moment it exists. Without this the picks would live
  // only in state and the chat would show the account default again when
  // reopened, since in-chat picks no longer touch that default.
  const commitSessionModelAndEffort = useCallback((sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }

    void selectProviderModel(provider, providerModels[provider], normalizedSessionId)
      .catch((error) => {
        console.warn('Failed to record the new session model:', error);
      });
    void selectProviderEffort(provider, currentProviderEffort, normalizedSessionId)
      .catch((error) => {
        console.warn('Failed to record the new session effort:', error);
      });
  }, [currentProviderEffort, provider, providerModels, selectProviderEffort, selectProviderModel]);

  return {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    opencodeModel,
    setOpenCodeModel,
    kimiModel,
    setKimiModel,
    geminiModel,
    setGeminiModel,
    grokModel,
    setGrokModel,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
    selectPermissionMode,
    commitPermissionModeToSession,
    commitSessionModelAndEffort,
    workMode,
    selectWorkMode,
    commitWorkModeToSession,
    resetComposerModesAfterSend,
    availablePermissionModes: getPermissionModesForProvider(provider),
    supportsWorkModeForProvider,
    providerModels,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsLoading,
    providerModelsRefreshing,
    hardRefreshProviderModels: () => loadProviderModels({ bypassCache: true }),
    selectProviderModel,
    selectProviderEffort,
    setStoredProviderModel,
    setStoredProviderEffort,
    resolvePermissionModeForProvider,
  };
}

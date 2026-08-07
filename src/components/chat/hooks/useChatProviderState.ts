import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
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
import { skipPermissionsDefaultMode } from '../utils/permissionDefaults';

const FALLBACK_DEFAULT_MODEL: Record<LLMProvider, string> = {
  claude: 'default',
  cursor: 'gpt-5.3-codex',
  codex: 'gpt-5.4',
  opencode: 'anthropic/claude-sonnet-4-5',
  kimi: 'kimi-code/k3',
  gemini: 'gemini-2.5-pro',
};

// Kimi re-added 2026-07-26 — including it here re-enables `loadProviderModels`
// below to fetch/populate providerModelCatalog.kimi, so the model dropdown and
// the new-chat picker show Kimi again. Login/usage is the user's own account.
// 'gemini' intentionally excluded — Google killed free personal-account login
// for Gemini CLI/Code Assist on 2026-06-18 (live test: OAuth token obtained,
// but Code Assist itself rejects with "no longer supported ... migrate to
// Antigravity"). Excluding it here also stops loadProviderModels from
// fetching providerModelCatalog.gemini. Re-add once there's a real login path.
const PROVIDERS: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode', 'kimi'];

const readStoredProvider = (): LLMProvider => {
  const storedProvider = localStorage.getItem('selected-provider');
  return PROVIDERS.includes(storedProvider as LLMProvider)
    ? storedProvider as LLMProvider
    : 'claude';
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

  const setStoredProviderModel = useCallback((targetProvider: LLMProvider, model: string) => {
    if (targetProvider === 'claude') {
      setClaudeModel(model);
      localStorage.setItem('claude-model', model);
    } else if (targetProvider === 'cursor') {
      setCursorModel(model);
      localStorage.setItem('cursor-model', model);
    } else if (targetProvider === 'codex') {
      setCodexModel(model);
      localStorage.setItem('codex-model', model);
    } else if (targetProvider === 'opencode') {
      setOpenCodeModel(model);
      localStorage.setItem('opencode-model', model);
    } else if (targetProvider === 'gemini') {
      setGeminiModel(model);
      localStorage.setItem('gemini-model', model);
    } else {
      setKimiModel(model);
      localStorage.setItem('kimi-model', model);
    }
    syncProviderModelToServer(targetProvider, model);
  }, [syncProviderModelToServer]);

  // Account-wide model/effort defaults, loaded once on mount and applied on
  // top of whatever localStorage had (server is the cross-device source of
  // truth; localStorage is just this browser's instant-paint cache).
  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/settings/provider-preferences')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { models?: Record<string, string>; efforts?: Record<string, string> } | null) => {
        if (cancelled || !data) {
          return;
        }
        for (const targetProvider of PROVIDERS) {
          const model = data.models?.[targetProvider];
          if (model) {
            if (targetProvider === 'claude') setClaudeModel(model);
            else if (targetProvider === 'cursor') setCursorModel(model);
            else if (targetProvider === 'codex') setCodexModel(model);
            else if (targetProvider === 'opencode') setOpenCodeModel(model);
            else if (targetProvider === 'gemini') setGeminiModel(model);
            else setKimiModel(model);
            localStorage.setItem(`${targetProvider}-model`, model);
          }
          const effort = data.efforts?.[targetProvider];
          if (effort) {
            localStorage.setItem(`${targetProvider}-effort`, effort);
          }
        }
        if (data.efforts) {
          setProviderEfforts((previous) => ({ ...previous, ...data.efforts }));
        }
      })
      .catch((error) => {
        console.warn('Failed to load account provider preferences:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setStoredProviderEffort = useCallback((targetProvider: LLMProvider, effort: string) => {
    setProviderEfforts((previous) => (
      previous[targetProvider] === effort
        ? previous
        : { ...previous, [targetProvider]: effort }
    ));
    localStorage.setItem(`${targetProvider}-effort`, effort);
    syncProviderEffortToServer(targetProvider, effort);
  }, [syncProviderEffortToServer]);

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

  const getPermissionModesForProvider = useCallback((targetProvider: LLMProvider): PermissionMode[] => {
    const capabilityModes = providerCapabilities?.[targetProvider]?.permissionModes;
    if (capabilityModes && capabilityModes.length > 0) {
      return capabilityModes as PermissionMode[];
    }
    return FALLBACK_PERMISSION_MODES[targetProvider] ?? ['default'];
  }, [providerCapabilities]);

  const getDefaultPermissionModeForProvider = useCallback((targetProvider: LLMProvider): PermissionMode => {
    const modes = getPermissionModesForProvider(targetProvider);
    // Global "skip permissions" switch, if on, decides the starting mode.
    const skipDefault = skipPermissionsDefaultMode(targetProvider, modes);
    if (skipDefault) {
      return skipDefault;
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

  // `current` (React state) must win over `storageKey` (the global last-used
  // default) whenever both are valid: `current` is what the hydration effect
  // below just set for this session, and re-reading localStorage first would
  // silently snap it back to the global default on every render — exactly
  // the bug that made per-session model memory look like it "didn't stick".
  // localStorage is only a fallback for the cases this function actually
  // exists for: first paint before `current` is set, or `current` holding a
  // model the catalog no longer lists.
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
  }), [claudeModel, cursorModel, codexModel, opencodeModel, kimiModel, geminiModel]);

  useEffect(() => {
    const claude = providerModelCatalog.claude;
    if (claude) {
      const next = pickStoredOrCurrent('claude-model', claudeModel, claude);
      if (next !== claudeModel) {
        setClaudeModel(next);
      }
      if (localStorage.getItem('claude-model') !== next) {
        localStorage.setItem('claude-model', next);
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
      if (localStorage.getItem('cursor-model') !== next) {
        localStorage.setItem('cursor-model', next);
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
      if (localStorage.getItem('codex-model') !== next) {
        localStorage.setItem('codex-model', next);
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
      if (localStorage.getItem('opencode-model') !== next) {
        localStorage.setItem('opencode-model', next);
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
      if (localStorage.getItem('kimi-model') !== next) {
        localStorage.setItem('kimi-model', next);
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
      if (localStorage.getItem('gemini-model') !== next) {
        localStorage.setItem('gemini-model', next);
      }
    }
  }, [providerModelCatalog.gemini, geminiModel]);

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
      localStorage.setItem(`${targetProvider}-effort`, nextEffort);
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

    if (provider === 'claude') {
      setClaudeModel(nextModel);
    } else if (provider === 'cursor') {
      setCursorModel(nextModel);
    } else if (provider === 'codex') {
      setCodexModel(nextModel);
    } else if (provider === 'opencode') {
      setOpenCodeModel(nextModel);
    } else if (provider === 'gemini') {
      setGeminiModel(nextModel);
    } else {
      setKimiModel(nextModel);
    }

    setProviderEfforts((previous) => (
      previous[provider] === nextEffort ? previous : { ...previous, [provider]: nextEffort }
    ));
  }, [selectedSession?.id, selectedSession?.model, selectedSession?.effort, provider]);

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

  // Called once, exactly when a brand-new chat's session id becomes real
  // (see ChatInterface's onSessionEstablished). Whatever mode is active
  // RIGHT NOW becomes this session's own permanent record — the only way a
  // mode picked before the first send survives the "no id" -> "real id"
  // jump, without ever touching any other chat's stored mode.
  const commitPermissionModeToSession = useCallback((sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }
    localStorage.setItem(`permissionMode-${normalizedSessionId}`, permissionMode);
  }, [permissionMode]);

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
      setStoredProviderModel(targetProvider, model);
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
    // A model pick made from inside a live session used to be scoped to just
    // that session, leaving every other chat on the old default. Dima wants
    // one global switch: persist it as the default too, so every new session
    // (and every session started after this one) picks it up automatically.
    setStoredProviderModel(targetProvider, resolvedModel);
    sessionOverridesRef.current[normalizedSessionId] = {
      ...sessionOverridesRef.current[normalizedSessionId],
      model: resolvedModel,
    };

    return {
      scope: 'session' as const,
      changed: body.data.changed === true,
      model: resolvedModel,
    };
  }, [setStoredProviderModel]);

  const selectProviderEffort = useCallback(async (
    targetProvider: LLMProvider,
    effort: string,
    sessionId?: string | null,
  ) => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      setStoredProviderEffort(targetProvider, effort);
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
    // Same "also becomes the new global default" behavior as selectProviderModel,
    // so a brand-new chat inherits whatever effort was picked most recently.
    setStoredProviderEffort(targetProvider, resolvedEffort);
    sessionOverridesRef.current[normalizedSessionId] = {
      ...sessionOverridesRef.current[normalizedSessionId],
      effort: resolvedEffort,
    };

    return {
      scope: 'session' as const,
      changed: body.data.changed === true,
      effort: resolvedEffort,
    };
  }, [setStoredProviderEffort]);

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
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
    selectPermissionMode,
    commitPermissionModeToSession,
    availablePermissionModes: getPermissionModesForProvider(provider),
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

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
import { applyProviderModel, resolveModelEffort, type ProviderModelSetters } from '../utils/providerModelState';
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
  // 22.09.2026: real model ids with an effort chip, like Anthropic/OpenAI.
  // The old `grok-mode-*` presets still resolve server-side (hidden entries),
  // but a new chat must not start on one — see LEGACY_GROK_MODEL_IDS.
  grok: 'grok-4.7',
};

// Stored defaults (localStorage / account preferences) written while the
// picker offered mode presets. Mapped onto the real model the preset expands
// to, so the effort chip appears instead of a hidden preset with no chip.
// Sessions that already run on a preset are left alone: buildGrokArgs still
// expands them, and an existing chat never changes model under the user.
const LEGACY_GROK_MODEL_IDS: Record<string, string> = {
  'grok-mode-build': 'grok-4.7',
  'grok-mode-fast': 'grok-4.7',
  'grok-mode-auto': 'grok-4.7',
  'grok-mode-expert': 'grok-4.5',
  'grok-mode-heavy': 'grok-4.7',
};

const migrateStoredModel = (targetProvider: LLMProvider, model: string | null): string | null => {
  if (targetProvider === 'grok' && model && LEGACY_GROK_MODEL_IDS[model]) {
    return LEGACY_GROK_MODEL_IDS[model];
  }
  return model;
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
  // Choices belong to one model in one chat. Legacy provider-wide defaults
  // intentionally do not enter this map: they cannot establish model intent.
  const [providerEfforts, setProviderEfforts] = useState<Record<string, string>>({});
  const effortKey = useCallback((targetProvider: LLMProvider, model: string, sessionId = selectedSession?.id) => (
    `model-effort:${JSON.stringify([sessionId || 'draft', targetProvider, model])}`
  ), [selectedSession?.id]);
  const draftModelPickedRef = useRef(false);
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
    return migrateStoredModel('grok', localStorage.getItem('grok-model')) || FALLBACK_DEFAULT_MODEL.grok;
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
  const providerModelsInFlightRef = useRef(false);

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
  const effortWritesRef = useRef<Record<string, Promise<unknown>>>({});

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
          const model = migrateStoredModel(targetProvider, data.models?.[targetProvider] ?? null);
          if (model) {
            localStorage.setItem(`${targetProvider}-model`, model);
            if (!hasOpenSession && !draftModelPickedRef.current) {
              setActiveProviderModel(targetProvider, model);
            }
          }
          const effort = data.efforts?.[targetProvider];
          if (effort) {
            localStorage.setItem(`${targetProvider}-effort`, effort);
          }
        }
      })
      .catch((error) => {
        console.warn('Failed to load account provider preferences:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [setActiveProviderModel]);

  const loadProviderModels = useCallback(async (options: { bypassCache?: boolean } = {}) => {
    if (providerModelsInFlightRef.current) return;
    providerModelsInFlightRef.current = true;
    const requestId = providerModelsRequestIdRef.current + 1;
    providerModelsRequestIdRef.current = requestId;
    const isHardRefresh = options.bypassCache === true;

    if (isHardRefresh) {
      setProviderModelsRefreshing(true);
    } else {
      setProviderModelsLoading(true);
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const results = await Promise.allSettled(
        PROVIDERS.map(async (p) => {
          const params = new URLSearchParams();
          if (options.bypassCache) {
            params.set('bypassCache', 'true');
          }

          const queryString = params.toString();
          const response = await authenticatedFetch(`/api/providers/${p}/models${queryString ? `?${queryString}` : ''}`, { signal: controller.signal });
          const body = (await response.json()) as ProviderModelsApiResponse;
          if (!response.ok || !body.success || !body.data?.models?.OPTIONS?.length || !body.data?.cache) {
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
        const result = results[i];
        const entry = result.status === 'fulfilled' ? result.value : null;
        if (!entry) {
          return;
        }

        nextCatalog[p] = entry.models;
        nextCacheCatalog[p] = entry.cache;
      });

      setProviderModelCatalog(previous => ({ ...previous, ...nextCatalog }));
      setProviderModelCacheCatalog(previous => ({ ...previous, ...nextCacheCatalog }));
    } catch (error) {
      console.error('Error loading provider models:', error);
    } finally {
      window.clearTimeout(timeout);
      providerModelsInFlightRef.current = false;
      if (providerModelsRequestIdRef.current === requestId) {
        setProviderModelsLoading(false);
        setProviderModelsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadProviderModels();
    const refresh = () => {
      if (document.visibilityState !== 'hidden') void loadProviderModels();
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
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
  const pickStoredOrCurrent = useCallback((
    storageKey: string,
    current: string,
    def: ProviderModelsDefinition,
  ): string => {
    // Historical/active sessions keep their model even when curation removes
    // it from the new-chat menu. Refreshing metadata must never switch a run.
    if (selectedSession?.id && current) return current;
    if (current && def.OPTIONS.some((o) => o.value === current && !o.hidden)) {
      return current;
    }
    const stored = localStorage.getItem(storageKey);
    if (stored && def.OPTIONS.some((o) => o.value === stored && !o.hidden)) {
      return stored;
    }
    return def.DEFAULT;
  }, [selectedSession?.id]);

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

    return [];
  }, [getModelOption, getSupportsEffortForProvider]);

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
  }, [providerModelCatalog.claude, claudeModel, pickStoredOrCurrent]);

  useEffect(() => {
    const cursor = providerModelCatalog.cursor;
    if (cursor) {
      const next = pickStoredOrCurrent('cursor-model', cursorModel, cursor);
      if (next !== cursorModel) {
        setCursorModel(next);
      }
    }
  }, [providerModelCatalog.cursor, cursorModel, pickStoredOrCurrent]);

  useEffect(() => {
    const codex = providerModelCatalog.codex;
    if (codex) {
      const next = pickStoredOrCurrent('codex-model', codexModel, codex);
      if (next !== codexModel) {
        setCodexModel(next);
      }
    }
  }, [providerModelCatalog.codex, codexModel, pickStoredOrCurrent]);

  useEffect(() => {
    const opencode = providerModelCatalog.opencode;
    if (opencode) {
      const next = pickStoredOrCurrent('opencode-model', opencodeModel, opencode);
      if (next !== opencodeModel) {
        setOpenCodeModel(next);
      }
    }
  }, [providerModelCatalog.opencode, opencodeModel, pickStoredOrCurrent]);

  useEffect(() => {
    const kimi = providerModelCatalog.kimi;
    if (kimi) {
      const next = pickStoredOrCurrent('kimi-model', kimiModel, kimi);
      if (next !== kimiModel) {
        setKimiModel(next);
      }
    }
  }, [providerModelCatalog.kimi, kimiModel, pickStoredOrCurrent]);

  useEffect(() => {
    const gemini = providerModelCatalog.gemini;
    if (gemini) {
      const next = pickStoredOrCurrent('gemini-model', geminiModel, gemini);
      if (next !== geminiModel) {
        setGeminiModel(next);
      }
    }
  }, [providerModelCatalog.gemini, geminiModel, pickStoredOrCurrent]);

  useEffect(() => {
    const grok = providerModelCatalog.grok;
    if (grok) {
      const next = pickStoredOrCurrent('grok-model', grokModel, grok);
      if (next !== grokModel) {
        setGrokModel(next);
      }
    }
  }, [providerModelCatalog.grok, grokModel, pickStoredOrCurrent]);

  const setActiveProviderEffort = useCallback((targetProvider: LLMProvider, effort: string, model = providerModels[targetProvider], sessionId = selectedSession?.id) => {
    const key = effortKey(targetProvider, model, sessionId);
    setProviderEfforts(previous => ({ ...previous, [key]: effort }));
    if (sessionId) localStorage.setItem(key, effort);
  }, [effortKey, providerModels, selectedSession?.id]);

  const setStoredProviderEffort = useCallback((targetProvider: LLMProvider, effort: string) => {
    localStorage.setItem(`${targetProvider}-effort`, effort);
    syncProviderEffortToServer(targetProvider, effort);
    if (!selectedSession?.id) setActiveProviderEffort(targetProvider, effort);
  }, [selectedSession?.id, setActiveProviderEffort, syncProviderEffortToServer]);

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

  useEffect(() => {
    if (selectedSession?.id) return;
    setProviderEfforts({});
    draftModelPickedRef.current = false;
  }, [selectedSession?.id]);

  // Session intent overrides legacy provider preferences. Reset remains a
  // symbolic default and is stored per model so switching back restores it.
  useEffect(() => {
    const localOverride = selectedSession?.id ? sessionOverridesRef.current[selectedSession.id] : undefined;

    const sessionModel = localOverride?.model
      ?? (typeof selectedSession?.model === 'string' && selectedSession.model ? selectedSession.model : null);
    const sessionEffort = localOverride?.effort
      ?? (typeof selectedSession?.effort === 'string' && selectedSession.effort ? selectedSession.effort : null);

    const nextModel = sessionModel
      ?? localStorage.getItem(`${provider}-model`)
      ?? FALLBACK_DEFAULT_MODEL[provider];
    const key = effortKey(provider, nextModel);
    const nextEffort = selectedSession?.id
      ? localStorage.getItem(key) ?? sessionEffort ?? DEFAULT_EFFORT_VALUE
      : DEFAULT_EFFORT_VALUE;
    if (!selectedSession?.id && draftModelPickedRef.current) return;

    applyProviderModel(provider, nextModel, providerModelSetters);

    setProviderEfforts((previous) => (
      previous[key] === nextEffort ? previous : { ...previous, [key]: nextEffort }
    ));
  }, [selectedSession?.id, selectedSession?.model, selectedSession?.effort, provider, providerModelSetters, effortKey]);

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
      draftModelPickedRef.current = true;
      setActiveProviderModel(targetProvider, model);
      return {
        scope: 'default' as const,
        changed: false,
        model,
      };
    }

    const key = effortKey(targetProvider, model, normalizedSessionId);
    const remembered = providerEfforts[key] ?? localStorage.getItem(key) ?? DEFAULT_EFFORT_VALUE;
    const nextEffort = resolveModelEffort(getModelOption(targetProvider, model), { model, effort: remembered });
    const queueKey = `${targetProvider}:${normalizedSessionId}`;
    const write = (effortWritesRef.current[queueKey] ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const response = await authenticatedFetch(
          `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/active-model`,
          { method: 'POST', body: JSON.stringify({ model, effort: nextEffort }) },
        );
        const body = await response.json() as ChangeActiveModelApiResponse;
        if (!response.ok || !body.success || !body.data?.supported) {
          throw new Error('Unable to change the active model for this session.');
        }
        const resolvedModel = body.data.model || model;
        if (selectedSessionIdRef.current === normalizedSessionId) {
          setActiveProviderModel(targetProvider, resolvedModel);
        }
        setActiveProviderEffort(targetProvider, nextEffort, resolvedModel, normalizedSessionId);
        sessionOverridesRef.current[normalizedSessionId] = {
          model: resolvedModel,
          effort: nextEffort,
        };
        return {
          scope: 'session' as const,
          changed: body.data.changed === true,
          model: resolvedModel,
          effort: nextEffort,
        };
      });
    effortWritesRef.current[queueKey] = write;
    try {
      return await write;
    } finally {
      if (effortWritesRef.current[queueKey] === write) delete effortWritesRef.current[queueKey];
    }
  }, [effortKey, getModelOption, providerEfforts, setActiveProviderEffort, setActiveProviderModel]);

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

    const model = providerModels[targetProvider];
    const intent = resolveModelEffort(getModelOption(targetProvider, model), { model, effort });
    // The next send and the controlled range follow intent immediately. Store
    // requests are ordered per session, so an older drag event cannot arrive
    // after reset and become the persisted value shown on another device.
    setActiveProviderEffort(targetProvider, intent, model, normalizedSessionId);
    sessionOverridesRef.current[normalizedSessionId] = {
      ...sessionOverridesRef.current[normalizedSessionId],
      effort: intent,
    };
    const queueKey = `${targetProvider}:${normalizedSessionId}`;
    const write = (effortWritesRef.current[queueKey] ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const activeModel = sessionOverridesRef.current[normalizedSessionId]?.model;
        if (activeModel && activeModel !== model) {
          // A queued model switch superseded this event from the old slider.
          return { scope: 'session' as const, changed: false, effort: intent };
        }
        const response = await authenticatedFetch(
          `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/active-effort`,
          { method: 'POST', body: JSON.stringify({ effort: intent }) },
        );
        const body = await response.json() as ChangeActiveEffortApiResponse;
        if (!response.ok || !body.success || !body.data?.supported) {
          throw new Error('Unable to change the active effort for this session.');
        }
        return { scope: 'session' as const, changed: body.data.changed === true, effort: intent };
      });
    effortWritesRef.current[queueKey] = write;
    try {
      return await write;
    } finally {
      if (effortWritesRef.current[queueKey] === write) delete effortWritesRef.current[queueKey];
    }
  }, [getModelOption, providerModels, setActiveProviderEffort]);

  const currentProviderEffortOptions = useMemo(() => {
    return getEffortOptionsForModel(provider, providerModels[provider]);
  }, [getEffortOptionsForModel, provider, providerModels]);
  const currentProviderEffort = useMemo(() => {
    const model = providerModels[provider];
    return resolveModelEffort(getModelOption(provider, model), {
      model,
      effort: providerEfforts[effortKey(provider, model)] ?? DEFAULT_EFFORT_VALUE,
    });
  }, [effortKey, getModelOption, provider, providerEfforts, providerModels]);

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

    const key = effortKey(provider, providerModels[provider], normalizedSessionId);
    localStorage.setItem(key, currentProviderEffort);
    void selectProviderModel(provider, providerModels[provider], normalizedSessionId)
      .catch((error) => {
        console.warn('Failed to record the new session model:', error);
      });

  }, [currentProviderEffort, effortKey, provider, providerModels, selectProviderModel]);

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

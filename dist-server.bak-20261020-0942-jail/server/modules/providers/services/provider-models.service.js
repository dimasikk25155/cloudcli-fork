import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { providerRegistry } from '../../../modules/providers/provider.registry.js';
import { readProviderSessionActiveModelChange } from '../../../shared/utils.js';
// Provider CLIs refresh their own metadata; poll their local catalogs at most once a minute.
export const PROVIDER_MODELS_CACHE_TTL_MS = 60_000;
// v10: curated families, factory effort defaults and maximum context windows.
const PROVIDER_MODELS_CACHE_VERSION = 10;
const getProviderModelsCachePath = () => path.join(os.homedir(), '.cloudcli', 'provider-models-cache.json');
const toProviderModelsCacheInfo = (entry, source) => ({
    updatedAt: new Date(entry.updatedAt).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString(),
    source,
});
const isProviderModelOption = (value) => (Boolean(value)
    && typeof value === 'object'
    && typeof value.value === 'string'
    && typeof value.label === 'string'
    && (value.contextWindow === undefined
        || (Number.isFinite(value.contextWindow)
            && value.contextWindow > 0))
    && (typeof value.description === 'undefined'
        || typeof value.description === 'string'));
const isProviderModelsDefinition = (value) => (Boolean(value)
    && typeof value === 'object'
    && Array.isArray(value.OPTIONS)
    && value.OPTIONS.length > 0
    && value.OPTIONS.every(isProviderModelOption)
    && value.OPTIONS.some((option) => !option.hidden && option.value === value.DEFAULT)
    && typeof value.DEFAULT === 'string');
const isProviderModelsCacheEntry = (value) => (Boolean(value)
    && typeof value === 'object'
    && typeof value.updatedAt === 'number'
    && typeof value.expiresAt === 'number'
    && isProviderModelsDefinition(value.models));
const readProviderModelsCacheFile = async (cachePath) => {
    try {
        const raw = await readFile(cachePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.version !== PROVIDER_MODELS_CACHE_VERSION || !parsed.entries || typeof parsed.entries !== 'object') {
            return null;
        }
        const entries = Object.fromEntries(Object.entries(parsed.entries).filter((entry) => isProviderModelsCacheEntry(entry[1])));
        return {
            version: PROVIDER_MODELS_CACHE_VERSION,
            entries,
        };
    }
    catch {
        return null;
    }
};
const writeProviderModelsCacheFile = async (cachePath, entries, now) => {
    const serializableEntries = Object.fromEntries([...entries.entries()].filter(([, entry]) => entry.expiresAt > now));
    const payload = {
        version: PROVIDER_MODELS_CACHE_VERSION,
        entries: serializableEntries,
    };
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};
/**
 * Provider model lookup service.
 *
 * Routes and other service callers use this layer instead of resolving provider
 * classes directly so the provider-registry dependency stays centralized in one
 * place.
 */
export const createProviderModelsService = (dependencies = {}) => {
    const resolveProvider = dependencies.resolveProvider ?? providerRegistry.resolveProvider;
    const cachePath = dependencies.cachePath ?? getProviderModelsCachePath();
    const now = dependencies.now ?? (() => Date.now());
    const memoryCache = new Map();
    const pendingRequests = new Map();
    let persistedCacheLoaded = false;
    let persistedCacheLoadPromise = null;
    const pruneExpiredMemoryEntry = (provider, currentTime, source) => {
        const cachedEntry = memoryCache.get(provider);
        if (!cachedEntry) {
            return null;
        }
        if (cachedEntry.expiresAt > currentTime) {
            return {
                models: cachedEntry.models,
                cache: toProviderModelsCacheInfo(cachedEntry, source),
            };
        }
        return null;
    };
    const loadPersistedCache = async () => {
        if (persistedCacheLoaded) {
            return;
        }
        if (!persistedCacheLoadPromise) {
            persistedCacheLoadPromise = (async () => {
                const cacheFile = await readProviderModelsCacheFile(cachePath);
                for (const [provider, entry] of Object.entries(cacheFile?.entries ?? {})) {
                    memoryCache.set(provider, entry);
                }
                persistedCacheLoaded = true;
            })().finally(() => {
                persistedCacheLoadPromise = null;
            });
        }
        await persistedCacheLoadPromise;
    };
    const persistCache = async () => {
        try {
            await writeProviderModelsCacheFile(cachePath, memoryCache, now());
        }
        catch (error) {
            console.warn('Unable to persist provider models cache:', error);
        }
    };
    const setCacheEntry = async (provider, models) => {
        const currentTime = now();
        const entry = {
            updatedAt: currentTime,
            expiresAt: currentTime + PROVIDER_MODELS_CACHE_TTL_MS,
            models,
        };
        memoryCache.set(provider, entry);
        await persistCache();
        return entry;
    };
    const loadAndCacheModels = (provider) => {
        const request = resolveProvider(provider).models.getSupportedModels()
            .then(async (models) => {
            if (!isProviderModelsDefinition(models))
                throw new Error('Provider returned an invalid model catalog');
            const entry = await setCacheEntry(provider, models);
            return {
                models,
                cache: toProviderModelsCacheInfo(entry, 'fresh'),
            };
        })
            .catch((error) => {
            const previous = memoryCache.get(provider);
            if (!previous)
                throw error;
            previous.expiresAt = now() + PROVIDER_MODELS_CACHE_TTL_MS;
            console.warn(`Unable to refresh ${provider} model catalog; retaining last valid snapshot`);
            return { models: previous.models, cache: toProviderModelsCacheInfo(previous, 'memory') };
        })
            .finally(() => {
            pendingRequests.delete(provider);
        });
        pendingRequests.set(provider, request);
        return request;
    };
    const getProviderModels = async (provider, options = {}) => {
        if (options.bypassCache) {
            const pendingRequest = pendingRequests.get(provider);
            if (pendingRequest) {
                return pendingRequest;
            }
            return loadAndCacheModels(provider);
        }
        const cachedModels = pruneExpiredMemoryEntry(provider, now(), 'memory');
        if (cachedModels) {
            return cachedModels;
        }
        const pendingRequest = pendingRequests.get(provider);
        if (pendingRequest) {
            return pendingRequest;
        }
        await loadPersistedCache();
        const persistedModels = pruneExpiredMemoryEntry(provider, now(), 'disk');
        if (persistedModels) {
            return persistedModels;
        }
        const postLoadPendingRequest = pendingRequests.get(provider);
        if (postLoadPendingRequest) {
            return postLoadPendingRequest;
        }
        return loadAndCacheModels(provider);
    };
    const getCurrentActiveModel = async (provider, sessionId) => resolveProvider(provider).models.getCurrentActiveModel(sessionId);
    const changeActiveModel = async (provider, input) => resolveProvider(provider).models.changeActiveModel(input);
    const getChangedActiveModel = async (provider, sessionId) => readProviderSessionActiveModelChange(provider, sessionId);
    const resolveResumeModel = async (provider, sessionId, requestedModel) => {
        const normalizedRequestedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
        if (!sessionId?.trim()) {
            return normalizedRequestedModel || undefined;
        }
        const changedModel = await getChangedActiveModel(provider, sessionId);
        if (changedModel.supported && changedModel.changed && changedModel.model?.trim()) {
            return changedModel.model.trim();
        }
        return normalizedRequestedModel || undefined;
    };
    /**
     * The current send carries the composer's latest effort intent. It must
     * beat a persisted override because the settings POST may still be queued.
     * Requests that omit effort resume the stored session choice instead.
     */
    const resolveResumeEffort = async (provider, sessionId, requestedEffort, requestedModel) => {
        // Other providers retain their existing semantics.
        const validatedProvider = ['claude', 'codex', 'grok'].includes(provider);
        const changed = sessionId?.trim() ? await getChangedActiveModel(provider, sessionId) : null;
        if (!validatedProvider)
            return changed?.effort?.trim() || requestedEffort?.trim() || undefined;
        const catalog = (await getProviderModels(provider)).models;
        const model = changed?.model || requestedModel || (sessionId ? (await getCurrentActiveModel(provider, sessionId)).model : null) || catalog.DEFAULT;
        const option = catalog.OPTIONS.find((candidate) => candidate.value === model);
        const allowed = option?.effort?.values.map((value) => value.value) || [];
        const explicitRequest = typeof requestedEffort === 'string' ? requestedEffort.trim() : '';
        const candidate = explicitRequest || changed?.effort?.trim();
        if (candidate && candidate !== 'default' && allowed.includes(candidate))
            return candidate;
        const fallback = option?.effort?.default;
        return fallback && allowed.includes(fallback) ? fallback : undefined;
    };
    const clearCache = () => {
        memoryCache.clear();
        pendingRequests.clear();
        persistedCacheLoaded = false;
        persistedCacheLoadPromise = null;
    };
    return {
        getProviderModels,
        getCurrentActiveModel,
        getChangedActiveModel,
        changeActiveModel,
        resolveResumeModel,
        resolveResumeEffort,
        clearCache,
    };
};
export const providerModelsService = createProviderModelsService();
//# sourceMappingURL=provider-models.service.js.map
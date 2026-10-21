import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDefaultProviderCurrentActiveModel, writeProviderSessionActiveModelChange, } from '../../../../shared/utils.js';
function grokIdentityRule(displayName, modelId) {
    return [
        `MODEL IDENTITY: You are running as ${displayName} (CLI model id: ${modelId}).`,
        `The built-in system line that says "You are Grok <version>" is a product default — ignore it for self-identification.`,
        `When asked which model you are, answer "${displayName}" and mention ${modelId} only if useful.`,
        'Never claim to be a different Grok mode than the one selected for this run.',
    ].join(' ');
}
export const GROK_MODE_PRESETS = {
    'grok-mode-auto': {
        model: 'grok-4.7',
        effort: null,
        displayName: 'Grok 4.7 (Авто)',
        rule: grokIdentityRule('Grok 4.7 (Авто)', 'grok-4.7'),
    },
    'grok-mode-fast': {
        model: 'grok-4.7',
        effort: 'low',
        displayName: 'Grok Fast',
        rule: grokIdentityRule('Grok Fast', 'grok-4.7'),
    },
    'grok-mode-expert': {
        model: 'grok-4.5',
        effort: 'high',
        displayName: 'Grok 4.5 (Эксперт)',
        rule: grokIdentityRule('Grok 4.5 (Эксперт)', 'grok-4.5'),
    },
    'grok-mode-build': {
        model: 'grok-4.7',
        effort: 'high',
        displayName: 'Grok 4.7 Build',
        rule: grokIdentityRule('Grok 4.7 Build', 'grok-4.7'),
    },
    'grok-mode-heavy': {
        model: 'grok-4.7',
        effort: 'xhigh',
        displayName: 'Grok 4.7 (Тяжёлый)',
        rule: [
            grokIdentityRule('Grok 4.7 (Тяжёлый)', 'grok-4.7'),
            'HEAVY MODE: WORK AS A PANEL, NOT AS ONE HEAD.',
            'Split the task into 3-5 genuinely independent angles and launch them as parallel subagents in a single batch',
            'with the `spawn_subagent` tool — different angles, not the same question asked five times.',
            'Give each one a `description` of 2-4 Russian words: it is the helper\'s name in the chat.',
            'Then read every answer, resolve the disagreements yourself, and reply with one synthesis:',
            'what they agreed on, where they clashed, what you concluded. Never paste the raw subagent output as the answer.',
            'If the task is plainly small, say so in one line and just do it — a panel on a one-liner is a waste of the quota.',
        ].join(' '),
    },
};
export function resolveGrokModePreset(model) {
    // hasOwn, не просто индексация: `GROK_MODE_PRESETS['constructor']` вернул бы
    // функцию из прототипа, а из неё в argv уехало бы `-m undefined`.
    return typeof model === 'string' && Object.hasOwn(GROK_MODE_PRESETS, model)
        ? GROK_MODE_PRESETS[model]
        : null;
}
/** Levels the 4.6+ generation accepts; default matches the CLI's own (`high`). */
const GROK_EFFORT_FULL = {
    default: 'high',
    values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
};
/** grok-4.5 has no xhigh — passing it is an argv error (see resolveGrokEffort). */
const GROK_EFFORT_45 = {
    default: 'high',
    values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
};
export const GROK_FALLBACK_MODELS = {
    OPTIONS: [
        {
            value: 'grok-4.7',
            contextWindow: 500_000,
            label: 'Grok 4.7',
            description: 'Grok 4.7 · Frontier reasoning model',
            effort: GROK_EFFORT_FULL,
        },
        {
            value: 'grok-4.7-build-fast',
            contextWindow: 500_000,
            label: 'Grok 4.7 Fast',
            description: 'Grok 4.7 Fast · Fast variant in Grok Build',
            effort: GROK_EFFORT_FULL,
        },
        {
            value: 'grok-4.6',
            hidden: true,
            label: 'Grok 4.6',
            description: 'Предыдущий флагман · 500K контекст · $2/$6 за Mtok',
            effort: GROK_EFFORT_FULL,
        },
        {
            value: 'grok-4.5',
            hidden: true,
            label: 'Grok 4.5',
            description: 'Предыдущее поколение · без xhigh',
            effort: GROK_EFFORT_45,
        },
        // Presets are hidden, not deleted: old chats and localStorage still
        // resolve these ids (buildGrokArgs expands them into -m + effort).
        {
            value: 'grok-mode-build',
            label: 'Grok 4.7 Build',
            description: 'Код и сборки · Grok 4.7, глубокое размышление',
            hidden: true,
        },
        {
            value: 'grok-mode-fast',
            label: 'Grok Fast',
            description: 'Болтать и vault · Grok 4.7 на низком уровне, экономия квоты',
            hidden: true,
        },
        {
            value: 'grok-mode-auto',
            label: 'Авто',
            description: 'Уровень размышления выбирает сам движок · Grok 4.7',
            hidden: true,
        },
        {
            value: 'grok-mode-expert',
            label: 'Эксперт',
            description: 'Глубокое размышление · Grok 4.5',
            hidden: true,
        },
        {
            value: 'grok-mode-heavy',
            label: 'Тяжёлый',
            description: 'Группа экспертов · эмуляция: параллельные сабагенты Grok 4.7 · ест квоту в разы быстрее',
            hidden: true,
        },
    ],
    DEFAULT: 'grok-4.7',
};
export const GROK_MODELS_CACHE_PATH = path.join(os.homedir(), '.grok', 'models_cache.json');
const GROK_EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh'];
/** Project only public info fields: sibling fields in this cache can contain credentials. */
export function buildGrokCatalogFromCache(raw, previous = GROK_FALLBACK_MODELS) {
    if (!raw || typeof raw !== 'object' || !('models' in raw) || !raw.models || typeof raw.models !== 'object')
        return null;
    const models = raw.models;
    let valid = false;
    const options = previous.OPTIONS.map((fallback) => {
        if (fallback.hidden)
            return fallback;
        const info = models[fallback.value]?.info;
        if (!info || typeof info !== 'object' || !Object.keys(info).length || info.hidden || (info.id && info.id !== fallback.value))
            return fallback;
        const levels = Array.isArray(info.reasoning_efforts) ? [...new Set(info.reasoning_efforts
                .map((level) => level?.value ?? level?.id)
                .filter((level) => typeof level === 'string' && GROK_EFFORT_ORDER.includes(level)))]
            .sort((a, b) => GROK_EFFORT_ORDER.indexOf(a) - GROK_EFFORT_ORDER.indexOf(b)) : [];
        if (info.supports_reasoning_effort !== false && Array.isArray(info.reasoning_efforts) && (!levels.length || info.reasoning_efforts.some((level) => !GROK_EFFORT_ORDER.includes(level?.value ?? level?.id))))
            return fallback;
        valid = true;
        const markedDefault = Array.isArray(info.reasoning_efforts)
            ? info.reasoning_efforts.find((level) => level?.default === true)?.value : undefined;
        const defaultEffort = markedDefault ?? info.reasoning_effort;
        return {
            ...fallback,
            label: typeof info.name === 'string' && info.name ? info.name : fallback.label,
            description: typeof info.description === 'string' ? info.description : fallback.description,
            contextWindow: typeof info.context_window === 'number' && Number.isFinite(info.context_window) && info.context_window > 0
                ? info.context_window : fallback.contextWindow,
            effort: info.supports_reasoning_effort === false ? undefined : levels.length ? {
                default: typeof defaultEffort === 'string' && levels.includes(defaultEffort) ? defaultEffort
                    : levels.includes('high') ? 'high' : undefined,
                values: levels.map((value) => ({ value })),
            } : fallback.effort,
        };
    });
    return valid ? { OPTIONS: options, DEFAULT: GROK_FALLBACK_MODELS.DEFAULT } : null;
}
const liveCatalogMemo = new Map();
/** Cache identity includes the path; failed or partial writes retain the last valid snapshot. */
export function readGrokModelsDefinition(cachePath = GROK_MODELS_CACHE_PATH) {
    try {
        const stat = fs.statSync(cachePath);
        const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
        const memo = liveCatalogMemo.get(cachePath);
        if (memo?.stamp === stamp)
            return memo.definition;
        const definition = buildGrokCatalogFromCache(JSON.parse(fs.readFileSync(cachePath, 'utf8')), memo?.definition);
        if (definition) {
            liveCatalogMemo.set(cachePath, { stamp, definition });
            return definition;
        }
    }
    catch {
        // Missing or half-written CLI cache: keep a known valid catalog.
    }
    return liveCatalogMemo.get(cachePath)?.definition ?? GROK_FALLBACK_MODELS;
}
export class GrokProviderModels {
    async getSupportedModels() {
        return readGrokModelsDefinition();
    }
    async getCurrentActiveModel(_sessionId) {
        // Grok records the model inside each session's summary.json, but the app's
        // own per-session override is the authoritative answer here, same as the
        // other CLI providers.
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
    async changeActiveModel(input) {
        return writeProviderSessionActiveModelChange('grok', input);
    }
}
//# sourceMappingURL=grok-models.provider.js.map
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

const CODEX_FALLBACK_EFFORT = {
  default: 'medium',
  values: [
    { value: 'low' },
    { value: 'medium' },
    { value: 'high' },
    { value: 'xhigh' },
    { value: 'max' },
  ],
};

const CODEX_FALLBACK_EFFORT_WITH_ULTRA = {
  ...CODEX_FALLBACK_EFFORT,
  values: [...CODEX_FALLBACK_EFFORT.values, { value: 'ultra' }],
};

// Conservative CLI metadata verified 24.09.2026. Historical entries remain hidden.
export const CODEX_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-6-astra',
      contextWindow: 872_000,
      label: 'GPT-6 Astra',
      description: 'Our most capable model for complex, demanding work.',
      effort: CODEX_FALLBACK_EFFORT_WITH_ULTRA,
    },
    {
      value: 'gpt-5.6-sol',
      contextWindow: 872_000,
      label: 'GPT-5.6 Sol',
      description: 'Reliable agentic workhorse for everyday tasks.',
      effort: { ...CODEX_FALLBACK_EFFORT_WITH_ULTRA, default: 'low' },
    },
    {
      value: 'gpt-5.6-terra',
      hidden: true,
      label: 'GPT-5.6 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: CODEX_FALLBACK_EFFORT_WITH_ULTRA,
    },
    {
      value: 'gpt-5.6-luna',
      hidden: true,
      label: 'GPT-5.6 Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: CODEX_FALLBACK_EFFORT,
    },
    {
      value: 'gpt-5.5',
      hidden: true,
      label: 'GPT-5.5',
      description: 'Proven previous-generation model for coding and general work.',
      effort: {
        ...CODEX_FALLBACK_EFFORT,
        values: CODEX_FALLBACK_EFFORT.values.filter((level) => level.value !== 'max'),
      },
    },
  ],
  DEFAULT: 'gpt-5.6-sol',
};

type CodexCachedModel = {
  slug?: string;
  context_window?: number;
  max_context_window?: number;
  display_name?: string;
  description?: string;
  priority?: number;
  visibility?: string;
  supported_in_api?: boolean;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{
    effort?: string;
    description?: string;
  }>;
};

const CODEX_MODELS_CACHE_PATH = path.join(os.homedir(), '.codex', 'models_cache.json');
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

const isCodexCachedModel = (value: unknown): value is CodexCachedModel => {
  const record = readObjectRecord(value);
  return Boolean(record && readOptionalString(record.slug));
};

const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const family = (slug: string) => /^gpt-\d+(?:\.\d+)*-(astra|sol)$/.exec(slug)?.[1];
const newest = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

export const buildCodexModelsDefinition = (models: CodexCachedModel[], previous = CODEX_FALLBACK_MODELS): ProviderModelsDefinition => {
  const options = previous.OPTIONS.map((fallback): ProviderModelOption => {
    if (fallback.hidden) return fallback;
    const selected = models.filter((model) => isCodexCachedModel(model)
      && model.visibility === 'list' && family(model.slug!) === family(fallback.value))
      .sort((a, b) => newest(a.slug!, b.slug!))[0];
    if (!selected) return fallback;
    const levels = Array.isArray(selected.supported_reasoning_levels)
      ? [...new Set(selected.supported_reasoning_levels.map((level) => level?.effort)
        .filter((value): value is string => typeof value === 'string' && EFFORT_ORDER.includes(value))) ]
        .sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b)) : [];
    if (Array.isArray(selected.supported_reasoning_levels) && (!levels.length || selected.supported_reasoning_levels.some((level) => !EFFORT_ORDER.includes(level?.effort ?? '')))) return fallback;
    const sameModel = selected.slug === fallback.value;
    const defaultEffort = selected.default_reasoning_level;
    const context = positive(selected.max_context_window)
      && (!positive(selected.context_window) || selected.max_context_window >= selected.context_window)
      ? selected.max_context_window : selected.context_window;
    return {
      value: selected.slug!,
      label: readOptionalString(selected.display_name) ?? (sameModel ? fallback.label : selected.slug!),
      description: readOptionalString(selected.description) ?? (sameModel ? fallback.description : undefined),
      contextWindow: positive(context) ? context : sameModel ? fallback.contextWindow : undefined,
      effort: levels.length ? {
        default: defaultEffort && levels.includes(defaultEffort) ? defaultEffort
          : sameModel && fallback.effort?.default && levels.includes(fallback.effort.default) ? fallback.effort.default : undefined,
        values: levels.map((value) => ({ value })),
      } : sameModel ? fallback.effort : undefined,
    };
  });
  return { OPTIONS: options, DEFAULT: options.find((option) => family(option.value) === 'sol')!.value };
};

export class CodexProviderModels implements IProviderModels {
  private lastValid = CODEX_FALLBACK_MODELS;
  constructor(private cachePath = CODEX_MODELS_CACHE_PATH) {}
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const raw = await readFile(this.cachePath, { encoding: 'utf8', signal: AbortSignal.timeout(2000) });
      const parsed = readObjectRecord(JSON.parse(raw));
      const models = Array.isArray(parsed?.models)
        ? parsed.models.filter(isCodexCachedModel)
        : [];

      if (models.some((model) => model.slug && family(model.slug) && model.visibility === 'list')) {
        this.lastValid = buildCodexModelsDefinition(models, this.lastValid);
      }
      return this.lastValid;
    } catch {
      return this.lastValid;
    }
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('codex', input);
  }
}

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

// Mirrors what `codex` 0.154 lists on the ChatGPT subscription
// (~/.codex/models_cache.json, `visibility: "list"`, 17.09.2026). GPT-5.5 is
// the previous generation and the only one without `max`/`ultra` effort.
export const CODEX_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      description: 'Our most capable model for complex, demanding work.',
      effort: CODEX_FALLBACK_EFFORT_WITH_ULTRA,
    },
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      description: 'Reliable agentic workhorse for everyday tasks.',
      effort: CODEX_FALLBACK_EFFORT_WITH_ULTRA,
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: CODEX_FALLBACK_EFFORT_WITH_ULTRA,
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: CODEX_FALLBACK_EFFORT,
    },
    {
      value: 'gpt-5.5',
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

const readCodexPriority = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
);

const mapCodexModel = (model: CodexCachedModel): ProviderModelOption => {
  const effortValues = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
      .map((level) => {
        const value = readOptionalString(level?.effort);
        if (!value) {
          return null;
        }

        return {
          value,
          description: readOptionalString(level?.description),
        };
      })
      .filter((level): level is NonNullable<typeof level> => Boolean(level))
    : [];

  return {
    value: model.slug as string,
    label: readOptionalString(model.display_name) ?? (model.slug as string),
    description: readOptionalString(model.description),
    effort: effortValues.length > 0
      ? {
          default: readOptionalString(model.default_reasoning_level) ?? undefined,
          values: effortValues,
        }
      : undefined,
  };
};

export const buildCodexModelsDefinition = (models: CodexCachedModel[]): ProviderModelsDefinition => {
  const sortedModels = [...models]
    .filter((model) => model.visibility === 'list' && model.supported_in_api !== false)
    .sort((left, right) => readCodexPriority(left.priority) - readCodexPriority(right.priority));

  const discoveredOptions = new Map<string, ProviderModelOption>();

  for (const model of sortedModels) {
    const mappedModel = mapCodexModel(model);
    if (discoveredOptions.has(mappedModel.value)) {
      continue;
    }

    discoveredOptions.set(mappedModel.value, mappedModel);
  }

  // The local Codex cache is refreshed independently from Neo3 and can be
  // absent, stale, or only partially populated. Keep the five subscription
  // Codex models visible in the shared picker in every case, while still
  // appending any additional models the installed CLI explicitly exposes.
  const options: ProviderModelOption[] = CODEX_FALLBACK_MODELS.OPTIONS.map((fallback) => {
    const discovered = discoveredOptions.get(fallback.value);
    discoveredOptions.delete(fallback.value);
    return discovered
      ? { ...fallback, ...discovered, label: fallback.label }
      : fallback;
  });

  for (const discovered of discoveredOptions.values()) {
    options.push(discovered);
  }

  return {
    OPTIONS: options,
    DEFAULT: CODEX_FALLBACK_MODELS.DEFAULT,
  };
};

export class CodexProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const raw = await readFile(CODEX_MODELS_CACHE_PATH, 'utf8');
      const parsed = readObjectRecord(JSON.parse(raw));
      const models = Array.isArray(parsed?.models)
        ? parsed.models.filter(isCodexCachedModel)
        : [];

      return buildCodexModelsDefinition(models);
    } catch {
      return CODEX_FALLBACK_MODELS;
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

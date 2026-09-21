import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

/**
 * Grok Build's catalog comes straight from `grok models` on a logged-in box
 * (grok 1.0.40, 22.09.2026):
 *
 *   Default model: grok-4.7
 *   Available models:
 *     * grok-4.7 (default)
 *     - grok-4.7-build-fast
 *     - grok-4.6
 *     - grok-4.5
 *
 * All ride the SuperGrok / X Premium+ subscription through the OAuth token in
 * ~/.grok/auth.json and never touch the Claude Max limit. The ids are passed to
 * `grok -m <id>` verbatim.
 *
 * The effort levels are MODEL-SPECIFIC — ~/.grok/models_cache.json lists them
 * per model (`reasoning_efforts`), default `high` everywhere:
 *   grok-4.7 / grok-4.7-build-fast / grok-4.6 -> xhigh, high, medium, low
 *   grok-4.5                                   -> high, medium, low
 * `xhigh` on 4.5 is a hard argv error, not a downgrade (measured on 1.0.5 and
 * unchanged on 1.0.40).
 */
/**
 * Режимы (`grok-mode-*`) — это пресеты «модель + уровень размышления (+ правило)».
 * Разворот в argv — одно место: buildGrokArgs в server/grok-cli.js. Через него
 * идут чат, agent-run и /api/agent, поэтому псевдо-id физически не может утечь
 * в argv — а утёк бы, CLI ответил бы "unknown model id".
 *
 * 22.09.2026: пикер показывает РЕАЛЬНЫЕ модели с чипом уровня размышления —
 * как у Anthropic и OpenAI. Месяц Дима ехал на пресете «Grok 4.6 Build»
 * (= 4.6 + high) и не видел, что у 4.6 есть xhigh, а 4.7 вышел без нашего
 * ведома. Пресеты остаются со `hidden` только ради старых чатов и
 * localStorage; для новых чатов фронт переводит их на реальные id
 * (LEGACY_GROK_MODEL_IDS в useChatProviderState.ts).
 * «Тяжёлого» у CLI нет: эмуляция параллельными сабагентами, не SuperGrok Heavy.
 *
 * xAI's system line names the product default ("You are Grok 4.6" on 1.0.5)
 * whatever `-m` says, so each preset carries an identity `rule` that
 * overrides that self-report.
 */
export type GrokModePreset = {
  /** Реальный id для `grok -m` */
  model: string;
  /** Уровень для `--reasoning-effort`; null — не передавать флаг вообще */
  effort: string | null;
  /** Необязательная приписка к --rules */
  rule?: string;
  /** How the agent must name itself when asked which model it is */
  displayName?: string;
};

function grokIdentityRule(displayName: string, modelId: string): string {
  return [
    `MODEL IDENTITY: You are running as ${displayName} (CLI model id: ${modelId}).`,
    `The built-in system line that says "You are Grok <version>" is a product default — ignore it for self-identification.`,
    `When asked which model you are, answer "${displayName}" and mention ${modelId} only if useful.`,
    'Never claim to be a different Grok mode than the one selected for this run.',
  ].join(' ');
}

export const GROK_MODE_PRESETS: Record<string, GrokModePreset> = {
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
      'with the `task` tool — different angles, not the same question asked five times.',
      'Then read every answer, resolve the disagreements yourself, and reply with one synthesis:',
      'what they agreed on, where they clashed, what you concluded. Never paste the raw subagent output as the answer.',
      'If the task is plainly small, say so in one line and just do it — a panel on a one-liner is a waste of the quota.',
    ].join(' '),
  },
};

export function resolveGrokModePreset(model?: string | null): GrokModePreset | null {
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

export const GROK_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'grok-4.7',
      label: 'Grok 4.7',
      description: 'Флагман xAI · 500K контекст, текст+картинки · $2/$6 за Mtok · подписка SuperGrok, не тратит лимит Claude',
      effort: GROK_EFFORT_FULL,
    },
    {
      value: 'grok-4.7-build-fast',
      label: 'Grok 4.7 Fast',
      description: 'Тот же 4.7, отвечает быстрее · в 2 раза дороже (ест квоту вдвое быстрее) · когда ждать некогда',
      effort: GROK_EFFORT_FULL,
    },
    {
      value: 'grok-4.6',
      label: 'Grok 4.6',
      description: 'Предыдущий флагман · 500K контекст · $2/$6 за Mtok',
      effort: GROK_EFFORT_FULL,
    },
    {
      value: 'grok-4.5',
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

/**
 * Descriptions the CLI cache does not carry (xAI ships one line at most).
 * Keyed by model id; a model missing here gets the CLI's own description.
 */
const GROK_MODEL_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  GROK_FALLBACK_MODELS.OPTIONS
    .filter((option) => !option.hidden && option.description)
    .map((option) => [option.value, option.description as string]),
);

export const GROK_MODELS_CACHE_PATH = path.join(os.homedir(), '.grok', 'models_cache.json');

type GrokModelsCacheFile = {
  models?: Record<string, {
    info?: {
      id?: string;
      name?: string;
      description?: string | null;
      hidden?: boolean;
      reasoning_effort?: string | null;
      supports_reasoning_effort?: boolean;
      reasoning_efforts?: { value?: string; id?: string }[] | null;
    };
  }>;
};

/**
 * Builds the picker catalog from `~/.grok/models_cache.json` — the list the
 * CLI itself fetches from xAI on every start (`grok models`). This is what
 * lets a new Grok show up in Neo3 the day it ships, instead of a month later
 * (22.09.2026: 4.7 had been out for weeks while the static catalog still
 * offered «4.6 Build»). Effort levels come per model from the same file; the
 * CLI lists them strongest-first, the chip wants weakest-first.
 * Returns null when the file is missing or unreadable — the static fallback
 * takes over. Exported for tests.
 */
export function buildGrokCatalogFromCache(raw: unknown): ProviderModelsDefinition | null {
  const models = (raw as GrokModelsCacheFile | null)?.models;
  if (!models || typeof models !== 'object') {
    return null;
  }
  const options: ProviderModelsDefinition['OPTIONS'] = [];
  for (const [key, entry] of Object.entries(models)) {
    const info = entry?.info;
    const id = typeof info?.id === 'string' && info.id ? info.id : key;
    if (!id || info?.hidden) {
      continue;
    }
    const levels = Array.isArray(info?.reasoning_efforts)
      ? info!.reasoning_efforts!
        .map((level) => level?.value ?? level?.id)
        .filter((level): level is string => typeof level === 'string' && level.length > 0)
        .reverse()
      : [];
    const option: ProviderModelsDefinition['OPTIONS'][number] = {
      value: id,
      label: typeof info?.name === 'string' && info.name ? info.name : id,
      description: GROK_MODEL_DESCRIPTIONS[id]
        ?? (typeof info?.description === 'string' && info.description ? info.description : undefined),
    };
    if (info?.supports_reasoning_effort !== false && levels.length > 0) {
      option.effort = {
        default: typeof info?.reasoning_effort === 'string' && levels.includes(info.reasoning_effort)
          ? info.reasoning_effort
          : undefined,
        values: levels.map((value) => ({ value })),
      };
    }
    options.push(option);
  }
  if (options.length === 0) {
    return null;
  }
  // The presets ride along hidden so old sessions keep resolving; a preset
  // whose target model vanished from the CLI would die with "unknown model
  // id", so those are dropped rather than offered.
  const known = new Set(options.map((option) => option.value));
  for (const option of GROK_FALLBACK_MODELS.OPTIONS) {
    if (option.hidden && GROK_MODE_PRESETS[option.value] && known.has(GROK_MODE_PRESETS[option.value].model)) {
      options.push(option);
    }
  }
  return {
    OPTIONS: options,
    // The CLI lists its default first (`* grok-4.7 (default)`).
    DEFAULT: known.has(GROK_FALLBACK_MODELS.DEFAULT) ? GROK_FALLBACK_MODELS.DEFAULT : options[0].value,
  };
}

let liveCatalogMemo: { mtimeMs: number; definition: ProviderModelsDefinition } | null = null;

/**
 * Synchronous, memoised by the cache file's mtime: called on every Grok run
 * (resolveGrokEffort) as well as by the picker, so it must stay cheap and
 * must never throw.
 */
export function readGrokModelsDefinition(cachePath: string = GROK_MODELS_CACHE_PATH): ProviderModelsDefinition {
  try {
    const mtimeMs = fs.statSync(cachePath).mtimeMs;
    if (liveCatalogMemo && liveCatalogMemo.mtimeMs === mtimeMs) {
      return liveCatalogMemo.definition;
    }
    const definition = buildGrokCatalogFromCache(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
    if (definition) {
      liveCatalogMemo = { mtimeMs, definition };
      return definition;
    }
  } catch {
    // No CLI cache yet (never logged in) or a half-written file — fall back.
  }
  return GROK_FALLBACK_MODELS;
}

export class GrokProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return readGrokModelsDefinition();
  }

  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    // Grok records the model inside each session's summary.json, but the app's
    // own per-session override is the authoritative answer here, same as the
    // other CLI providers.
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('grok', input);
  }
}

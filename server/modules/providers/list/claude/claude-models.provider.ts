import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
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
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

// Everything the Claude Code `/model` picker offers on the Max subscription
// (verified live on 2.1.273, 17.09.2026, each entry answered a one-word
// prompt). Values are what `claude --model` takes: `opus[1m]`-style aliases
// resolve to the newest model of that family, so `fable` is Fable 5.1 and
// `opus[1m]` is Opus 5.5 today (re-verified on 2.1.281, 24.09.2026).
// Sonnet 4.6 is deliberately WITHOUT `[1m]` — the CLI answers "Usage credits
// required for 1M context" on the subscription for that one.
const CLAUDE_EFFORT_FIVE = {
  default: 'high',
  values: [
    { value: 'low' },
    { value: 'medium' },
    { value: 'high' },
    { value: 'xhigh' },
    { value: 'max' },
  ],
};

export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'opus[1m]',
      label: 'Opus 5.5',
      description: 'Opus 5.5 · Most capable for ambitious work',
      contextWindow: 1_000_000,
      effort: { ...CLAUDE_EFFORT_FIVE, default: 'medium' },
    },
    {
      value: 'sonnet[1m]',
      label: 'Sonnet 5',
      description: 'Sonnet 5 · Efficient for everyday tasks',
      contextWindow: 1_000_000,
      effort: CLAUDE_EFFORT_FIVE,
    },
    {
      value: 'fable',
      label: 'Fable 5.1',
      description: 'Fable 5.1 · For your toughest challenges',
      contextWindow: 1_000_000,
      effort: CLAUDE_EFFORT_FIVE,
    },
    // No `effort` block: Haiku 4.5 rejects the effort parameter, and omitting
    // it makes resolveClaudeEffort strip whatever the UI sends.
    {
      value: 'haiku',
      hidden: true,
      label: 'Haiku 4.5',
      description: 'Haiku 4.5 · Fastest for quick answers · 200K context · $1/$5 per Mtok',
    },
    // Previous generation — still served on the subscription, kept for the
    // people who prefer their behaviour on a specific task.
    {
      value: 'claude-opus-5[1m]',
      hidden: true,
      label: 'Opus 5',
      description: 'Opus 5 · Previous Opus version · 1M context · $5/$25 per Mtok',
      effort: CLAUDE_EFFORT_FIVE,
    },
    {
      value: 'claude-opus-4-8[1m]',
      hidden: true,
      label: 'Opus 4.8',
      description: 'Opus 4.8 · Previous Opus version · 1M context · $5/$25 per Mtok',
      effort: CLAUDE_EFFORT_FIVE,
    },
    {
      value: 'claude-sonnet-4-6',
      hidden: true,
      label: 'Sonnet 4.6',
      description: 'Sonnet 4.6 · Previous Sonnet version · 200K context (1M needs usage credits) · $3/$15 per Mtok',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    // Local models on the RTX 5070 (see LOCAL_MODEL_MAP in claude-sdk.js).
    // Free and independent of the Claude Max limit, but no prompt caching:
    // every turn reprocesses the whole history, so keep sessions short.
    // No `effort` block — Ollama has no effort control, and omitting it makes
    // resolveClaudeEffort strip whatever the UI sends.
    // `hidden` since 21.08.2026: the picker shows only the subscription
    // models (Anthropic / OpenAI / xAI). Flip the flag to bring one
    // back — nothing else has to change.
    {
      value: 'local-ornith-9b',
      hidden: true,
      label: 'Local · Ornith 9B',
      description: 'Runs on your RTX 5070 · free, no Claude limit · best local tool-calling · short tasks',
    },
    {
      value: 'local-qwen35-9b',
      hidden: true,
      label: 'Local · Qwen3.5 9B',
      description: 'Runs on your RTX 5070 · free, no Claude limit · strong Russian · fallback if Ornith misbehaves',
    },
    // Third-party subscriptions (see BYO_MODEL_MAP in claude-sdk.js). Flat
    // monthly rate on the provider's own plan, so they keep working when the
    // Claude 5-hour window is spent. No `effort` block — neither gateway
    // understands Anthropic's effort levels, so resolveClaudeEffort strips it.
    // Hidden alongside the local ones (see above) — wired, just not offered.
    {
      value: 'minimax-m3',
      hidden: true,
      label: 'MiniMax M3',
      description: 'Own $20/mo plan, no Claude limit · understands screenshots · 1M context · use when the Claude window is spent',
    },
    {
      value: 'glm-5-2',
      hidden: true,
      label: 'GLM-5.2',
      description: 'Own $18/mo plan, no Claude limit · contractually not trained on your data · 1M context · safest for client work',
    },
  ],
  DEFAULT: 'opus[1m]',
};

const CLAUDE_CATALOG_PATH = path.join(os.homedir(), '.claude', 'cache', 'model-catalog');
const CLAUDE_EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const claudeFamily = (id: string) => /^(?:claude-)?(opus|sonnet|fable)(?:-\d+(?:-\d+)*|\[1m\])?$/.exec(id)?.[1];
const timestamp = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;

/** Only fresh account catalogs confirm availability; saved thinking state is not a factory default. */
export function buildClaudeModelsDefinition(raw: unknown, now = Date.now(), previous = CLAUDE_FALLBACK_MODELS): ProviderModelsDefinition | null {
  const root = readObjectRecord(raw);
  if (!root || !(timestamp(root.staleAt) > now)) return null;
  const catalog = readObjectRecord(root.catalog);
  const config = readObjectRecord(catalog?.config);
  if (!Array.isArray(config?.models)) return null;
  const models = config.models.map(readObjectRecord).filter((model) => model && typeof model.id === 'string' && typeof model.name === 'string');
  if (!models.some((model) => claudeFamily(model!.id as string))) return null;
  const options = previous.OPTIONS.map((fallback): ProviderModelOption => {
    if (fallback.hidden) return fallback;
    const selected = models.filter((model) => claudeFamily(model!.id as string) === claudeFamily(fallback.value))
      .sort((a, b) => (b!.id as string).localeCompare(a!.id as string, undefined, { numeric: true }))[0];
    if (!selected) return fallback;
    const thinking = readObjectRecord(selected.thinking);
    const rawLevels = Array.isArray(thinking?.effort_options) ? thinking.effort_options.map(readObjectRecord).filter(Boolean) : [];
    const levels = [...new Set(rawLevels.map((level) => level!.id).filter((id): id is string => typeof id === 'string' && CLAUDE_EFFORT_ORDER.includes(id)))]
      .sort((a, b) => CLAUDE_EFFORT_ORDER.indexOf(a) - CLAUDE_EFFORT_ORDER.indexOf(b));
    if (thinking?.type !== 'none' && Array.isArray(thinking?.effort_options) && (!levels.length || thinking.effort_options.some((level) => { const id = readObjectRecord(level)?.id; return typeof id !== 'string' || !CLAUDE_EFFORT_ORDER.includes(id); }))) return fallback;
    const markedDefault = rawLevels.find((level) => readObjectRecord(level!.badge)?.message === 'Default')?.id;
    const sameVersion = selected.name === fallback.label;
    return {
      ...fallback,
      label: selected.name as string,
      description: typeof selected.description === 'string' ? selected.description : fallback.description,
      contextWindow: typeof selected.context_window === 'number' && Number.isFinite(selected.context_window) && selected.context_window > 0
        ? selected.context_window : sameVersion ? fallback.contextWindow : undefined,
      effort: levels.length ? {
        default: typeof markedDefault === 'string' && levels.includes(markedDefault) ? markedDefault
          : sameVersion && fallback.effort?.default && levels.includes(fallback.effort.default) ? fallback.effort.default : undefined,
        values: levels.map((value) => ({ value })),
      } : thinking?.type === 'none' ? undefined : sameVersion ? fallback.effort : undefined,
    };
  });
  return { OPTIONS: options, DEFAULT: CLAUDE_FALLBACK_MODELS.DEFAULT };
}

const claudeCatalogMemo = new Map<string, ProviderModelsDefinition>();
export function readClaudeModelsDefinition(cacheDirectory = CLAUDE_CATALOG_PATH, now = Date.now()): ProviderModelsDefinition {
  let best: { fetchedAt: number; definition: ProviderModelsDefinition } | undefined;
  try {
    for (const file of fs.readdirSync(cacheDirectory).filter((file) => file.endsWith('-cc.json'))) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(cacheDirectory, file), 'utf8'));
        const definition = buildClaudeModelsDefinition(raw, now, claudeCatalogMemo.get(cacheDirectory));
        const fetchedAt = timestamp(raw.fetchedAt);
        if (definition && Number.isFinite(fetchedAt) && (!best || fetchedAt > best.fetchedAt)) best = { fetchedAt, definition };
      } catch {
        // A concurrent or malformed account-cache write cannot replace a valid catalog.
      }
    }
  } catch {
    // CLI has not populated its catalog directory yet; retain the last valid snapshot.
  }
  if (best) claudeCatalogMemo.set(cacheDirectory, best.definition);
  return best?.definition ?? claudeCatalogMemo.get(cacheDirectory) ?? CLAUDE_FALLBACK_MODELS;
}

export const findClaudeModelOption = (model: string | undefined | null): ProviderModelOption | null => {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return null;
  }

  return readClaudeModelsDefinition().OPTIONS.find((option) => option.value === normalizedModel) ?? null;
};
type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

const ANSI_PATTERN = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const directModel = event.model?.trim();
  if (directModel) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel || null;
};

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsi(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    if (changedModel?.[1]?.trim()) {
      return changedModel[1].trim();
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag || null;
};

const extractClaudeModelFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return extractClaudeModelFromTextContent(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
      continue;
    }

    const model = extractClaudeModelFromTextContent(part.text);
    if (model) {
      return model;
    }
  }

  return null;
};

const readClaudeSessionModelFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ProviderCurrentActiveModel | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeInitEvent;
      const model = extractClaudeEventModel(event, sessionId);
      if (model) {
        return { model };
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

export class ClaudeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return readClaudeModelsDefinition();
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const jsonlPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(sessionId, jsonlPath)
        : null;
      if (activeModel?.model) {
        return activeModel;
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('claude', input);
  }
}

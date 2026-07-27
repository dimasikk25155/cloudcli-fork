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
 * Kimi Code CLI has no `models` command — model aliases live in the user's
 * config.toml (managed provider `managed:kimi-code`). The managed catalog is
 * stable, so the list is static. Aliases must match config.toml entries;
 * the runner passes them to `kimi -m <alias>` verbatim.
 *
 * All models ride the same Kimi Code subscription (OAuth login or console API
 * key) and never touch the Claude Max limit.
 *
 * The headless CLI (`kimi -p`) has no `--effort` flag — but it DOES honor
 * each model alias's `default_effort` from config.toml (confirmed by reading
 * the per-session wire.jsonl: the `llm.request` event's `thinkingEffort`
 * field matches the alias's configured value exactly). So instead of a
 * runtime effort selector, K3's three effort tiers are exposed as three
 * separate model aliases (`k3` / `k3-low` / `k3-max`) — same trick already
 * used for the K2.7 Coding vs Coding-Highspeed pair below. Aliases must be
 * added to config.toml first, otherwise `kimi -m <alias>` fails to resolve.
 */
export const KIMI_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'kimi-code/k3',
      label: 'K3',
      description: 'Kimi K3 · флагман, 1M контекст, high effort · подписка Kimi, не тратит лимит Claude',
    },
    {
      value: 'kimi-code/k3-low',
      label: 'K3 (Low effort)',
      description: 'Kimi K3 · low effort — быстрее и дешевле по токенам, меньше размышления',
    },
    {
      value: 'kimi-code/k3-max',
      label: 'K3 (Max effort)',
      description: 'Kimi K3 · max effort — максимум размышления перед ответом',
    },
    {
      value: 'kimi-code/kimi-for-coding',
      label: 'K2.7 Coding',
      description: 'Kimi K2.7 Coding · кодовая модель · подписка Kimi',
    },
    {
      value: 'kimi-code/kimi-for-coding-highspeed',
      label: 'K2.7 Coding Highspeed',
      description: 'Kimi K2.7 Coding с ускоренной генерацией · подписка Kimi',
    },
  ],
  DEFAULT: 'kimi-code/k3',
};

export class KimiProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return KIMI_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    // Kimi sessions don't expose a per-session active model on disk, so the
    // provider default is the only honest answer.
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('kimi', input);
  }
}

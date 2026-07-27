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
 * Gemini CLI takes the model as `-m <id>` and has no command that lists the
 * ids, so the catalog is static. Every id here was read out of the installed
 * CLI's own model constants (0.52.0), and `gemini-2.5-pro` is the CLI's
 * built-in default — the safe pick, since it is available on the plain Google
 * account login while the 3.x previews depend on the account's tier.
 *
 * All models ride the Google account's own quota (OAuth / Gemini Code Assist),
 * so they never touch the Claude Max limit.
 */
export const GEMINI_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      description: 'Стабильный флагман, дефолт самого Gemini CLI · подписка Google, не тратит лимит Claude',
    },
    {
      value: 'gemini-3.1-pro-preview',
      label: 'Gemini 3.1 Pro (preview)',
      description: 'Самая свежая Pro-модель · доступна не на всех аккаунтах (превью)',
    },
    {
      value: 'gemini-3.5-flash',
      label: 'Gemini 3.5 Flash',
      description: 'Быстрая модель нового поколения — для рутины и больших объёмов',
    },
    {
      value: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      description: 'Стабильная быстрая модель · дешевле Pro по расходу',
    },
    {
      value: 'gemini-3.1-flash-lite',
      label: 'Gemini 3.1 Flash Lite',
      description: 'Самая экономная — простые задачи, максимальная скорость',
    },
  ],
  DEFAULT: 'gemini-2.5-pro',
};

export class GeminiProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return GEMINI_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    // Gemini sessions do not record a per-session model on disk, so the
    // provider default is the only honest answer.
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('gemini', input);
  }
}

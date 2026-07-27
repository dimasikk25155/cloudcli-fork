import type { IProviderSkills } from '@/shared/interfaces.js';
import type {
  LLMProvider,
  ProviderSkill,
  ProviderSkillCreateInput,
  ProviderSkillListOptions,
  ProviderSkillRemoveInput,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Skills management for Gemini is not wired yet.
 *
 * Gemini scans `.gemini/skills` (user and workspace) and exposes its own
 * `gemini skills` command, so the layout is known — but the on-disk record
 * format has not been confirmed against a real installed skill, and this
 * provider is not going to invent one. Listing reports nothing; writes refuse
 * rather than scatter files the CLI may not read back.
 */
export class GeminiSkillsProvider implements IProviderSkills {
  private readonly provider: LLMProvider = 'gemini';

  async listSkills(_options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    return [];
  }

  async addSkills(_input: ProviderSkillCreateInput): Promise<ProviderSkill[]> {
    throw new AppError('Managing skills for Gemini is not supported yet.', {
      code: 'PROVIDER_SKILLS_UNSUPPORTED',
      statusCode: 501,
    });
  }

  async removeSkill(
    input: ProviderSkillRemoveInput,
  ): Promise<{ removed: boolean; provider: LLMProvider; directoryName: string }> {
    return {
      removed: false,
      provider: this.provider,
      directoryName: input.directoryName,
    };
  }
}

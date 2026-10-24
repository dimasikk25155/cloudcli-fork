import { AppError } from '../../../../shared/utils.js';
/**
 * Skills management for Gemini is not wired yet.
 *
 * Gemini scans `.gemini/skills` (user and workspace) and exposes its own
 * `gemini skills` command, so the layout is known — but the on-disk record
 * format has not been confirmed against a real installed skill, and this
 * provider is not going to invent one. Listing reports nothing; writes refuse
 * rather than scatter files the CLI may not read back.
 */
export class GeminiSkillsProvider {
    provider = 'gemini';
    async listSkills(_options) {
        return [];
    }
    async addSkills(_input) {
        throw new AppError('Managing skills for Gemini is not supported yet.', {
            code: 'PROVIDER_SKILLS_UNSUPPORTED',
            statusCode: 501,
        });
    }
    async removeSkill(input) {
        return {
            removed: false,
            provider: this.provider,
            directoryName: input.directoryName,
        };
    }
}
//# sourceMappingURL=gemini-skills.provider.js.map
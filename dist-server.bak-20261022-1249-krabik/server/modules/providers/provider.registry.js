import { ClaudeProvider } from '../../modules/providers/list/claude/claude.provider.js';
import { CodexProvider } from '../../modules/providers/list/codex/codex.provider.js';
import { CursorProvider } from '../../modules/providers/list/cursor/cursor.provider.js';
import { GeminiProvider } from '../../modules/providers/list/gemini/gemini.provider.js';
import { GrokProvider } from '../../modules/providers/list/grok/grok.provider.js';
import { KimiProvider } from '../../modules/providers/list/kimi/kimi.provider.js';
import { OpenCodeProvider } from '../../modules/providers/list/opencode/opencode.provider.js';
import { AppError } from '../../shared/utils.js';
const providers = {
    claude: new ClaudeProvider(),
    codex: new CodexProvider(),
    cursor: new CursorProvider(),
    opencode: new OpenCodeProvider(),
    kimi: new KimiProvider(),
    gemini: new GeminiProvider(),
    grok: new GrokProvider(),
};
/**
 * Central registry for resolving concrete provider implementations by id.
 */
export const providerRegistry = {
    listProviders() {
        return Object.values(providers);
    },
    resolveProvider(provider) {
        const key = provider;
        const resolvedProvider = providers[key];
        if (!resolvedProvider) {
            throw new AppError(`Unsupported provider "${provider}".`, {
                code: 'UNSUPPORTED_PROVIDER',
                statusCode: 400,
            });
        }
        return resolvedProvider;
    },
};
//# sourceMappingURL=provider.registry.js.map
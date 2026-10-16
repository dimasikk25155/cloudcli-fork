import { GrokProviderAuth } from '../../../../modules/providers/list/grok/grok-auth.provider.js';
import { GrokProviderModels } from '../../../../modules/providers/list/grok/grok-models.provider.js';
import { GrokMcpProvider } from '../../../../modules/providers/list/grok/grok-mcp.provider.js';
import { GrokSessionSynchronizer } from '../../../../modules/providers/list/grok/grok-session-synchronizer.provider.js';
import { GrokSessionsProvider } from '../../../../modules/providers/list/grok/grok-sessions.provider.js';
import { GrokSkillsProvider } from '../../../../modules/providers/list/grok/grok-skills.provider.js';
import { AbstractProvider } from '../../../../modules/providers/shared/base/abstract.provider.js';
export class GrokProvider extends AbstractProvider {
    models = new GrokProviderModels();
    mcp = new GrokMcpProvider();
    auth = new GrokProviderAuth();
    skills = new GrokSkillsProvider();
    sessions = new GrokSessionsProvider();
    sessionSynchronizer = new GrokSessionSynchronizer();
    constructor() {
        super('grok');
    }
}
//# sourceMappingURL=grok.provider.js.map
import { KimiProviderAuth } from '../../../../modules/providers/list/kimi/kimi-auth.provider.js';
import { KimiProviderModels } from '../../../../modules/providers/list/kimi/kimi-models.provider.js';
import { KimiMcpProvider } from '../../../../modules/providers/list/kimi/kimi-mcp.provider.js';
import { KimiSessionSynchronizer } from '../../../../modules/providers/list/kimi/kimi-session-synchronizer.provider.js';
import { KimiSessionsProvider } from '../../../../modules/providers/list/kimi/kimi-sessions.provider.js';
import { KimiSkillsProvider } from '../../../../modules/providers/list/kimi/kimi-skills.provider.js';
import { AbstractProvider } from '../../../../modules/providers/shared/base/abstract.provider.js';
export class KimiProvider extends AbstractProvider {
    models = new KimiProviderModels();
    mcp = new KimiMcpProvider();
    auth = new KimiProviderAuth();
    skills = new KimiSkillsProvider();
    sessions = new KimiSessionsProvider();
    sessionSynchronizer = new KimiSessionSynchronizer();
    constructor() {
        super('kimi');
    }
}
//# sourceMappingURL=kimi.provider.js.map
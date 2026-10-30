import express from 'express';
import { teamTelegram } from '../../modules/team-telegram/team-telegram.service.js';
function bearer(req) {
    const header = req.headers.authorization;
    if (typeof header !== 'string')
        return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : null;
}
/**
 * Streamable-HTTP endpoint of the gatekeeper (plain JSON replies, no stream).
 * No JWT: the run's Bearer token is the credential, as for threads.
 */
export function createTeamTelegramRoutes(service = teamTelegram) {
    const router = express.Router();
    router.post('/', async (req, res) => {
        const grant = service.grantFor(bearer(req));
        if (!grant) {
            res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
            return;
        }
        const reply = await service.handle(grant, req.body);
        if (reply === null) {
            res.status(202).end();
            return;
        }
        res.json(reply);
    });
    // No server-initiated stream and no session to close.
    router.get('/', (_req, res) => { res.status(405).end(); });
    router.delete('/', (_req, res) => { res.status(200).end(); });
    return router;
}
export default createTeamTelegramRoutes();
//# sourceMappingURL=team-telegram.routes.js.map
import express from 'express';
import { promptCacheTtlMin, sessionAttention } from '../../modules/session-attention/session-attention.service.js';
import { asyncHandler } from '../../shared/utils.js';
/**
 * "Ждут тебя" HTTP API. Mounted behind `authenticateToken` at `/api/attention`.
 *
 * GET  /            → { items: AttentionItem[], counts: { waiting, failed, unreadDone, working }, promptCacheTtlMin }
 * POST /seen        { sessionIds: string[] } | { all: true } → { marked: number }
 */
const router = express.Router();
function readUser(req) {
    const user = req.user;
    const id = user?.id ?? user?.userId;
    if (typeof id !== 'number' && typeof id !== 'string') {
        return null;
    }
    return { id, role: typeof user?.role === 'string' ? user.role : null };
}
router.get('/', asyncHandler(async (req, res) => {
    const user = readUser(req);
    if (!user) {
        res.status(401).json({ error: 'Нужна авторизация' });
        return;
    }
    const items = sessionAttention.listForUser(user);
    res.json({ items, counts: sessionAttention.countsFor(items), promptCacheTtlMin: promptCacheTtlMin() });
}));
router.post('/seen', asyncHandler(async (req, res) => {
    const user = readUser(req);
    if (!user) {
        res.status(401).json({ error: 'Нужна авторизация' });
        return;
    }
    const body = (req.body ?? {});
    if (body.all === true) {
        res.json(sessionAttention.markSeen(user, { all: true }));
        return;
    }
    if (!Array.isArray(body.sessionIds)) {
        res.status(400).json({ error: 'Нужен sessionIds (массив) или all: true' });
        return;
    }
    const sessionIds = body.sessionIds.filter((id) => typeof id === 'string' && id.length > 0);
    res.json(sessionAttention.markSeen(user, { sessionIds }));
}));
export default router;
//# sourceMappingURL=session-attention.routes.js.map
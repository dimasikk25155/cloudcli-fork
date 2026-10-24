import express from 'express';
import { pendingAnswers } from '../../modules/pending-answers/pending-answers.service.js';
import { MOD_OFF, modOffMessage } from '../../shared/mods.js';
import { asyncHandler } from '../../shared/utils.js';
/**
 * POST /api/attention/answer { token } — a push button was pressed.
 *
 * Public by design, like the sticky-push «Сделал» button: the service worker
 * has no JWT. The one-time token is the right to answer (bound to one user,
 * one request, one choice, 24 h). Mounted BEFORE the authenticated
 * `/api/attention` router.
 *
 * Every response carries `message` — the text of the quiet result
 * notification the service worker shows.
 */
const router = express.Router();
const FAILURES = {
    already_answered: { status: 409, message: 'Уже отвечено' },
    expired: { status: 410, message: 'Кнопка устарела — открой сессию' },
    invalid: { status: 404, message: 'Кнопка не действует — открой сессию' },
    forbidden: { status: 403, message: 'Нет доступа к этой сессии' },
    unavailable: { status: 503, message: 'Не получилось ответить — открой сессию' },
    // Another tap of this question is being delivered: not answered yet.
    in_progress: { status: 429, message: 'Ответ уже отправляется — подожди секунду' },
    // The owner switched answer buttons off after this push went out.
    [MOD_OFF]: { status: 409, message: `${modOffMessage('modAnswerButtons')} — открой сессию` },
};
router.post('/', asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token || token.length > 128) {
        res.status(400).json({ ok: false, reason: 'invalid', message: FAILURES.invalid.message });
        return;
    }
    const result = await pendingAnswers.redeemToken(token, { via: 'push' });
    if (result.ok) {
        res.json({ ok: true, label: result.label, sessionId: result.sessionId, message: `Ответ отправлен: ${result.label}` });
        return;
    }
    const failure = FAILURES[result.reason];
    res.status(failure.status).json({
        ok: false,
        reason: result.reason,
        message: failure.message,
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
    });
}));
export default router;
//# sourceMappingURL=pending-answers.routes.js.map
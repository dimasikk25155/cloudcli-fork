import express from 'express';
import { getSessionLinks } from '../../modules/session-links/session-links.service.js';
import { asyncHandler } from '../../shared/utils.js';
/**
 * Mounted at `/api/sessions` behind authenticateToken.
 * GET /:id/links → `{parent?, children[]}` (SessionLinks); 404 / 403 via AppError.
 */
const router = express.Router();
router.get('/:id/links', asyncHandler(async (req, res) => {
    const user = req.user;
    res.json(getSessionLinks(String(req.params.id ?? ''), user));
}));
export default router;
//# sourceMappingURL=session-links.routes.js.map
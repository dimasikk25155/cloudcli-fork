import express from 'express';
import type { Request, Response } from 'express';

import { StashError, stashSecret } from '@/modules/secrets-stash/secrets-stash.service.js';

/**
 * POST /api/secrets/stash {name, value} → {name}
 *
 * Mounted behind authenticateToken + requireAdmin: only the admin writes into
 * Dima's secrets file. The response carries the final name (possibly `_2`)
 * and nothing else; errors are fixed strings, the value is never logged.
 */
const router = express.Router();

router.post('/stash', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown; value?: unknown };
  try {
    const { name } = await stashSecret({ name: body.name, value: body.value });
    res.json({ name });
  } catch (error) {
    if (error instanceof StashError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    // Unknown failure: report only the error code, never the request body.
    console.error('secrets stash failed', { code: (error as NodeJS.ErrnoException)?.code ?? 'unknown' });
    res.status(500).json({ error: 'Не удалось сохранить секрет' });
  }
});

export default router;

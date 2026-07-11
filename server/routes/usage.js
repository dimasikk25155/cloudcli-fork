import express from 'express';

import {
  getClaudeUsage,
  resolveUsageGuardThreshold,
} from '../shared/claude-usage.js';

const router = express.Router();

// Live subscription usage (5h / 7d windows) + the run-guard threshold, for
// the composer badge and the pre-send confirmation.
router.get('/limits', async (req, res) => {
  try {
    const usage = await getClaudeUsage();
    const threshold = resolveUsageGuardThreshold();
    const fiveHourPct = usage?.fiveHour?.utilization ?? null;
    res.json({
      ok: true,
      usage,
      guard: {
        threshold,
        blocked: fiveHourPct !== null && fiveHourPct >= threshold,
      },
    });
  } catch (error) {
    console.error('Error fetching usage limits:', error);
    res.status(500).json({ ok: false, error: 'Failed to fetch usage limits' });
  }
});

export default router;

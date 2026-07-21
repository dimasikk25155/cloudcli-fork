import express from 'express';

import {
  getClaudeUsage,
  resolveUsageGuardThreshold,
} from '../shared/claude-usage.js';
import { getSessionUsageHistory } from '../shared/session-usage.js';

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

// Per-session token history grouped by Moscow day (newest first), for the
// expandable "Token Usage" dashboard. Numbers are full API throughput per
// session, so they are larger than the single-turn `/cost` snapshot.
router.get('/history', async (req, res) => {
  try {
    const days = await getSessionUsageHistory();
    res.json({ ok: true, days });
  } catch (error) {
    console.error('Error building usage history:', error);
    res.status(500).json({ ok: false, error: 'Failed to build usage history' });
  }
});

export default router;

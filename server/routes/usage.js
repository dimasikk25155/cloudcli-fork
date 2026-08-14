import express from 'express';

import {
  getClaudeUsage,
  resolveUsageGuardThreshold,
} from '../shared/claude-usage.js';
import { getKimiUsage } from '../shared/kimi-usage.js';
import { getSessionUsageHistory } from '../shared/session-usage.js';
import { getProjectStats } from '../shared/project-stats.js';
import { projectsDb, userProjectAccessDb } from '../modules/database/index.js';

const router = express.Router();

// A caller may only ask about a project they can actually open. Without this the
// endpoint would happily walk any absolute path on the server.
function canReadProject(user, projectPath) {
  const rows = projectsDb.getProjectPaths();
  const match = rows.find((row) => row.project_path === projectPath);
  if (!match) return false;
  if (!user || user.role === 'admin') return true;
  return userProjectAccessDb.getAccessibleProjectIds(user.id).includes(match.project_id);
}

// Live subscription usage (5h / 7d windows) + the run-guard threshold, for
// the composer badge and the pre-send confirmation. `kimi` is the same
// window pair for the separate Kimi Code subscription (null when no key).
router.get('/limits', async (req, res) => {
  try {
    const [usage, kimi] = await Promise.all([getClaudeUsage(), getKimiUsage()]);
    const threshold = resolveUsageGuardThreshold();
    const fiveHourPct = usage?.fiveHour?.utilization ?? null;
    res.json({
      ok: true,
      usage,
      kimi,
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

// Everything the Statistics tab shows for one project: size on disk (files,
// lines, languages) plus the Claude work spent on it (sessions, tokens, cost).
router.get('/project-stats', async (req, res) => {
  const projectPath = String(req.query.path || '').trim();
  if (!projectPath) {
    return res.status(400).json({ ok: false, error: 'Missing project path' });
  }
  if (!canReadProject(req.user, projectPath)) {
    return res.status(403).json({ ok: false, error: 'Project not accessible' });
  }
  try {
    const stats = await getProjectStats(projectPath);
    return res.json({ ok: true, stats });
  } catch (error) {
    console.error('Error building project stats:', error);
    return res.status(500).json({ ok: false, error: 'Failed to build project stats' });
  }
});

export default router;

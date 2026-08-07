import os from 'node:os';
import path from 'node:path';

import express from 'express';

import { readHistory, readScheduled } from './nightshift.parser.js';

// Read-only visibility into the night-shift orchestrator (launchd-scheduled
// Claude runs, see ~/.claude/skills/night-shift). This module only READS
// plists and run artifacts — scheduling stays with the orchestrator scripts.

const router = express.Router();

router.get('/', async (_req, res) => {
  const [scheduled, history] = await Promise.all([
    readScheduled(path.join(os.homedir(), 'Library', 'LaunchAgents')),
    readHistory(path.join(os.homedir(), '.claude', 'night-shift', 'runs')),
  ]);
  res.json({ success: true, scheduled, history });
});

export default router;

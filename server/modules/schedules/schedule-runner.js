#!/usr/bin/env node
// The process launchd/systemd actually starts: `node schedule-runner.js <id>`.
//
// Kept as plain .js on purpose — the file name is then identical in the source
// tree and in dist-server, so the plist/unit written by the running server keeps
// pointing at a real file after a production build.
//
// Import order matters: load-env.js must run before anything touches the
// database, because it is what resolves DATABASE_PATH.
import '../../load-env.js';

import { runScheduleNow } from './schedules.service.js';

const scheduleId = Number.parseInt(process.argv[2] ?? '', 10);

if (!Number.isInteger(scheduleId)) {
  console.error('Usage: schedule-runner.js <scheduleId>');
  process.exit(2);
}

try {
  const result = await runScheduleNow(scheduleId);
  console.log(`[${new Date().toISOString()}] schedule ${scheduleId} ok, session=${result.sessionId ?? 'none'}`);
  console.log(result.text.slice(0, 2000));
  // Engines can leave sockets or child processes behind; a scheduled run must
  // still terminate so the OS does not keep the job alive until the next one.
  process.exit(0);
} catch (error) {
  console.error(`[${new Date().toISOString()}] schedule ${scheduleId} failed:`, error?.message ?? error);
  process.exit(1);
}

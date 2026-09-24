#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createUpstreamChecker, defaultReportPath } from '../server/modules/upstream-updates/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const report = await createUpstreamChecker({ repo }).check();
  console.log(JSON.stringify({ status: report.status, checking: report.checking ?? false, checkedAt: report.checkedAt,
    fork: report.fork?.sha, release: report.release?.tag, main: report.upstream?.sha,
    error: report.error, approvalRequired: true, reportPath: defaultReportPath }, null, 2));
  if (report.status === 'error') process.exitCode = 1;
} catch (error) {
  console.error(`Upstream check failed: ${error.message}`);
  process.exitCode = 1;
}

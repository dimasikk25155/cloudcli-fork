#!/usr/bin/env node
// `npm test` entry: runs the tsx test runner against a throwaway database.
//
// Agent sessions spawned by Neo3 inherit DATABASE_PATH pointing at the live
// ~/.cloudcli/auth.db. Test harnesses swap in a temp DB and restore the
// previous path afterwards, so any write that lands after teardown (e.g. the
// session-attention history fallback resolving a tick late) used to hit the
// production database — 12.10.2026 it left `sess-alpha`/`app-run-*` rows in
// «Ждут тебя». Pointing the whole run at a temp home makes "restore" harmless.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(tmpdir(), 'cloudcli-test-db-'));
const tsxBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const args = [
  '--tsconfig', 'server/tsconfig.json',
  '--test', '--test-timeout=30000',
  'server/**/*.test.ts', 'server/**/*.test.js', 'src/**/*.test.ts', 'src/**/*.test.js',
  ...process.argv.slice(2),
];

const child = spawn(tsxBin, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    // Services write ~/.cloudcli/* (sticky-push token, model cache, run
    // outcomes, ...) straight from os.homedir(); a scratch HOME keeps every
    // one of them — present and future — off the live files.
    HOME: scratch,
    USERPROFILE: scratch,
    DATABASE_PATH: path.join(scratch, '.cloudcli', 'auth.db'),
  },
});

child.on('exit', (code, signal) => {
  rmSync(scratch, { recursive: true, force: true });
  process.exit(signal ? 1 : (code ?? 1));
});

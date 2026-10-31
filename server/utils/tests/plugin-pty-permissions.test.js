import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { repairPluginPtyPermissions } from '../plugin-process-manager.js';

test('a plugin can execute its unpacked node-pty helper; external symlinks stay untouched', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-pty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const plugin = path.join(root, 'plugin');
  const builds = path.join(plugin, 'node_modules/node-pty/prebuilds');
  for (const arch of ['darwin-arm64', 'darwin-x64']) await fs.mkdir(path.join(builds, arch), { recursive: true });
  const helper = path.join(builds, 'darwin-arm64/spawn-helper');
  const external = path.join(root, 'external-helper');
  await fs.writeFile(helper, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  await fs.writeFile(external, 'untouched', { mode: 0o644 });
  await fs.symlink(external, path.join(builds, 'darwin-x64/spawn-helper'));
  repairPluginPtyPermissions(plugin, 'darwin');
  await fs.access(helper, fs.constants.X_OK);
  assert.equal((await fs.stat(external)).mode & 0o777, 0o644);
  repairPluginPtyPermissions(plugin, 'darwin');
  repairPluginPtyPermissions(path.join(root, 'missing'), 'darwin');
});

/**
 * The production «Браузер вживую» service: helper binary from `NEO3_BROWSER_BIN`
 * or `~/.cloudcli/bin/neo3-browser`, unloaded after `NEO3_BROWSER_IDLE_MS`
 * (default 2 min) without requests and viewers. Creating it starts nothing.
 */

import { safariLiveBindingsDb } from '@/modules/database/index.js';

import { createBrowserDriver } from './safari-live.browser.js';
import { defaultHelperPath, helperInstalled, spawnBrowserHelper } from './safari-live.helper.js';
import { createSafariLiveService } from './safari-live.service.js';

const idleFromEnv = Number(process.env.NEO3_BROWSER_IDLE_MS);

export const browserDriver = createBrowserDriver({
  spawnHelper: () => spawnBrowserHelper(defaultHelperPath()),
  idleMs: Number.isFinite(idleFromEnv) && idleFromEnv > 0 ? idleFromEnv : 120_000,
});

export const safariLiveService = createSafariLiveService({
  driver: browserDriver,
  helperInstalled: () => helperInstalled(defaultHelperPath()),
  // The binding keeps the page's last address: an unloaded browser reopens it.
  onNavigated: (pageId, url, title) => {
    if (url.startsWith('http://') || url.startsWith('https://')) safariLiveBindingsDb.updatePage(pageId, { url, title });
  },
});

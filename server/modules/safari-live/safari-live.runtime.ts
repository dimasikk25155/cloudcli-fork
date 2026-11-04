/**
 * The production «Safari вживую» service: helper binary from
 * `NEO3_SAFARI_CAPTURE_BIN` or `~/.cloudcli/bin/neo3-safari-capture`.
 * Creating it starts nothing; processes start on first use.
 */

import { createHelperRunners } from './safari-live.helper.js';
import { createSafariLiveService } from './safari-live.service.js';

export const safariLiveService = createSafariLiveService({ ...createHelperRunners() });

import type { Register } from 'claude-code'

import { judgeForegroundLoop, readForegroundLoopMaxSec } from './loop-rule.ts'

/**
 * Loaded into every Claude session Neo3 starts (server/claude-sdk.js passes
 * this folder as an SDK `plugins` entry). The terminal Claude is untouched.
 */
export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const maxSec = readForegroundLoopMaxSec(await $.env.get('NEO3_FOREGROUND_LOOP_MAX_SEC'))
    const verdict = judgeForegroundLoop(e, maxSec)
    return verdict.deny ? { deny: verdict.reason } : next(e)
  }).catch(($, e, next) =>
    // A broken guard must not take the shell away: let the call through.
    next(e),
  )
}

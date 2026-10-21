import { existsSync } from 'fs';
import path from 'path';
import { findAppRoot, getModuleDir } from '../utils/runtime-paths.js';
/**
 * The `neo3-guards` Claude Code mod (`claude-plugins/neo3-guards`, see its
 * `hooks/loop-rule.ts`): refuses foreground wait loops longer than
 * NEO3_FOREGROUND_LOOP_MAX_SEC. Loaded per Neo3 session through the SDK's
 * `plugins` option, so the terminal Claude is never touched.
 *
 * Resolved from the app root, which works from both /server and
 * /dist-server/server. An install that ships without the folder gets no
 * plugin rather than a CLI that fails to start.
 *
 * @returns {Array<{type: 'local', path: string}>}
 */
export function neo3GuardsPlugins() {
    const dir = path.join(findAppRoot(getModuleDir(import.meta.url)), 'claude-plugins', 'neo3-guards');
    return existsSync(path.join(dir, '.claude-plugin', 'plugin.json')) ? [{ type: 'local', path: dir }] : [];
}
//# sourceMappingURL=neo3-guards-plugin.js.map
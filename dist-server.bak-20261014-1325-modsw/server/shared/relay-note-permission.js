import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
/**
 * Auto-relay handoff turn: the one write it may do without asking — a
 * Markdown note strictly inside `<project>/docs/handoff/`. Nothing else is
 * widened: other tools, other paths and other turns keep their usual rules.
 */
const NOTE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
/** Real path of `target`, resolving the deepest part that exists (the note itself may not yet). */
function realPathOf(target) {
    let existing = target;
    const rest = [];
    while (!existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing)
            return target;
        rest.unshift(path.basename(existing));
        existing = parent;
    }
    return path.join(realpathSync(existing), ...rest);
}
function isStrictlyInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
/**
 * True when `toolName`/`input` writes a `.md` note directly or deeper inside
 * `noteDir` (`<project>/docs/handoff`). `..` anywhere in the path is refused,
 * and symlinks may not lead out of the note folder or out of the project.
 */
export function isRelayNoteWrite(toolName, input, noteDir) {
    if (typeof toolName !== 'string' || !NOTE_TOOLS.has(toolName))
        return false;
    if (typeof noteDir !== 'string' || !path.isAbsolute(noteDir))
        return false;
    const raw = input?.file_path;
    if (typeof raw !== 'string' || !raw.trim() || raw.includes('\0'))
        return false;
    if (raw.split(/[\\/]+/).includes('..'))
        return false;
    const projectRoot = path.dirname(path.dirname(noteDir));
    const target = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(projectRoot, raw);
    if (path.extname(target).toLowerCase() !== '.md')
        return false;
    if (!isStrictlyInside(noteDir, target))
        return false;
    const realDir = realPathOf(noteDir);
    return isStrictlyInside(realPathOf(projectRoot), realDir) && isStrictlyInside(realDir, realPathOf(target));
}
//# sourceMappingURL=relay-note-permission.js.map
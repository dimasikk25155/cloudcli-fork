import { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { projectsDb, userProjectAccessDb } from '../modules/database/index.js';

// Directories that never contain files a chat message would reference, but that
// dominate the cost of a recursive scan.
const SEARCH_IGNORED_DIRS = new Set([
    'node_modules', 'dist', 'build', '.next', '.nuxt', '.cache', '.parcel-cache',
    '.git', '.svn', '.hg',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.tox', 'venv', '.venv',
    'target', 'vendor',
    '.gradle', '.idea', 'coverage', '.nyc_output',
    // macOS home noise
    'Library', 'Applications', 'Pictures', 'Music', 'Movies',
]);

// The recursive pass only runs when a reference could not be resolved directly,
// so these caps trade an exhaustive search for a bounded, predictable latency.
const MAX_SEARCH_DEPTH = 8;
const MAX_SEARCH_DIRS = 4000;
const SEARCH_TIME_BUDGET_MS = 1500;

const pathExists = async (candidate) => {
    try {
        await fsPromises.access(candidate);
        return true;
    } catch {
        return false;
    }
};

const isInside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

/**
 * Expand a leading `~` so home-relative references from chat resolve instead of
 * turning into a literal `<project>/~/...` path that never exists.
 */
const expandHome = (filePath) => {
    if (filePath === '~') return os.homedir();
    if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
        return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
};

/**
 * Roots the requesting user is allowed to read from, most specific first so a
 * deep project wins over a broad one (e.g. the home directory) when both match.
 */
function getSearchRoots(user, currentRoot) {
    let projects;
    try {
        projects = projectsDb.getProjectPaths();
    } catch {
        return [];
    }

    if (user?.role !== 'admin') {
        let accessible;
        try {
            accessible = new Set(userProjectAccessDb.getAccessibleProjectIds(user?.id));
        } catch {
            return [];
        }
        projects = projects.filter((project) => accessible.has(project.project_id));
    }

    return projects
        .map((project) => path.resolve(project.project_path))
        .filter((root) => root !== currentRoot)
        .sort((a, b) => b.length - a.length);
}

/**
 * Drop roots that live inside another root: scanning the ancestor already covers
 * them, and registered projects nest heavily (a workspace plus every repo in it),
 * which would otherwise walk the same tree dozens of times and exhaust the budget.
 */
function dropNestedRoots(roots) {
    const kept = [];
    for (const root of [...roots].sort((a, b) => a.length - b.length)) {
        if (!kept.some((existing) => isInside(existing, root))) {
            kept.push(root);
        }
    }
    return kept;
}

// Chat references routinely point just above the project (`.secrets.env` in the
// parent workspace, `../notes/todo.md`). Walking up is a handful of stats, so it
// runs before the wider search — but only far enough to stay meaningful.
const MAX_ANCESTOR_LEVELS = 8;

/**
 * Look for `relativePath` in the directories above the project root.
 *
 * Admin-only: a guest's project may sit inside a folder that holds other users'
 * work, so climbing out of it would hand them files they cannot otherwise see.
 */
async function findInAncestors(projectRoot, relativePath) {
    let dir = path.dirname(projectRoot);

    for (let level = 0; level < MAX_ANCESTOR_LEVELS; level += 1) {
        const candidate = path.resolve(dir, relativePath);
        if (await pathExists(candidate)) {
            return candidate;
        }

        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }

    return null;
}

/** Number of leading path segments two paths share. */
function sharedSegments(a, b) {
    const left = a.split(path.sep);
    const right = b.split(path.sep);
    let shared = 0;
    while (shared < left.length && shared < right.length && left[shared] === right[shared]) {
        shared += 1;
    }
    return shared;
}

/**
 * Scan the allowed roots for a directory that contains `relativePath`.
 *
 * The queue is ordered by how close a directory sits to the project the user is
 * looking at, then by depth — a `wiki/index.md` reference should land on the
 * vault next door, not on an unrelated copy that happens to sit one level higher
 * somewhere else. Bounded by depth/visited/time so an unresolvable reference
 * can't stall the request.
 */
async function findNearProject(roots, relativePath, projectRoot) {
    const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
    const queue = roots.map((root) => ({
        root,
        dir: root,
        depth: 0,
        affinity: sharedSegments(root, projectRoot),
    }));
    let visited = 0;

    while (queue.length > 0 && visited < MAX_SEARCH_DIRS && Date.now() <= deadline) {
        let bestIndex = 0;
        for (let index = 1; index < queue.length; index += 1) {
            const candidate = queue[index];
            const best = queue[bestIndex];
            if (candidate.affinity > best.affinity
                || (candidate.affinity === best.affinity && candidate.depth < best.depth)) {
                bestIndex = index;
            }
        }

        const { root, dir, depth } = queue.splice(bestIndex, 1)[0];
        visited += 1;

        const candidate = path.resolve(dir, relativePath);
        if (isInside(root, candidate) && await pathExists(candidate)) {
            return candidate;
        }

        if (depth >= MAX_SEARCH_DEPTH) {
            continue;
        }

        let entries;
        try {
            entries = await fsPromises.readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith('.') || SEARCH_IGNORED_DIRS.has(entry.name)) continue;
            const child = path.join(dir, entry.name);
            queue.push({
                root,
                dir: child,
                depth: depth + 1,
                affinity: sharedSegments(child, projectRoot),
            });
        }
    }

    return null;
}

/**
 * Resolve a file reference against an explicit set of roots.
 *
 * Chat messages routinely mention files that belong to another workspace (vault
 * notes, a sibling repo), and those references are relative to *their* root, not
 * to the currently selected project. Resolving them only against the selected
 * project made every such click fail with a 404, so this falls back to the other
 * roots the user may read — but only to paths that actually exist, which keeps
 * "save a new file" scoped to the current project.
 *
 * @returns {Promise<{ ok: true, resolved: string } | { ok: false, status: number, error: string }>}
 */
export async function resolveAgainstRoots({ filePath, projectRoot, fallbackRoots, isAdmin, allowSearch = true }) {
    const normalizedRoot = path.resolve(projectRoot);
    const expanded = expandHome(filePath);
    const isRelative = !path.isAbsolute(expanded);
    const direct = isRelative
        ? path.resolve(normalizedRoot, expanded)
        : path.resolve(expanded);

    const insideProject = isInside(normalizedRoot, direct);

    // Fast path: the reference points at a file that really is where the selected
    // project says it is. Everything below only runs for references that miss.
    if ((insideProject || isAdmin) && await pathExists(direct)) {
        return { ok: true, resolved: direct };
    }

    // Then the folders above the project: a shared `.secrets.env` or a note one
    // level up is the single most common miss, and the project's own parent is
    // not covered by the root/scan passes below (they only ever descend).
    if (allowSearch && isRelative && isAdmin) {
        const aboveProject = await findInAncestors(normalizedRoot, expanded);
        if (aboveProject) {
            return { ok: true, resolved: aboveProject };
        }
    }

    // A missing file whose directory does exist in this project is a file of this
    // project — newly created, renamed or deleted. Searching elsewhere would only
    // add latency to a 404 (or to saving a new file), so treat it as project-local.
    const parentIsInProject = insideProject && await pathExists(path.dirname(direct));

    // Roots are resolved lazily: the fast path above covers almost every request,
    // and collecting them means hitting the database.
    if (allowSearch && !parentIsInProject && isRelative) {
        const roots = typeof fallbackRoots === 'function' ? fallbackRoots() : (fallbackRoots ?? []);

        // Cheap pass first: the reference is often relative to another project root.
        for (const root of roots) {
            const candidate = path.resolve(root, expanded);
            if (isInside(root, candidate) && await pathExists(candidate)) {
                return { ok: true, resolved: candidate };
            }
        }

        // Then the bounded scan, which catches roots nested inside a known project
        // (e.g. an Obsidian vault living under a parent workspace).
        const found = await findNearProject(dropNestedRoots(roots), expanded, normalizedRoot);
        if (found) {
            return { ok: true, resolved: found };
        }
    }

    // Nothing matched: fall back to the project-local interpretation so a file
    // that does not exist yet can still be created, and so a genuinely missing
    // file keeps reporting 404 instead of 403. Admins own the machine and already
    // have shell access via the Terminal tab; guests stay locked to their roots.
    if (insideProject || isAdmin) {
        return { ok: true, resolved: direct };
    }

    return { ok: false, status: 403, error: 'Path must be under project root' };
}

/**
 * Find files by name alone, ignoring the folders around them.
 *
 * The resolver above always keeps the reference's own shape (`docs/x.md` must
 * sit in a `docs` folder). That is right for opening a file, but useless for the
 * "нет такого файла" screen: a path is usually wrong in the middle, not at the
 * end. Here only the last segment matters, so a moved or misfiled note is still
 * found and offered instead of a bare 404.
 */
export async function findByBasename({ name, projectRoot, user, limit = 10 }) {
    const target = path.basename(String(name || '').trim()).toLowerCase();
    if (!target || target === '.' || target === '..') {
        return [];
    }

    const normalizedRoot = path.resolve(projectRoot);
    const roots = dropNestedRoots([normalizedRoot, ...getSearchRoots(user, normalizedRoot)]);
    const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
    const queue = roots.map((root) => ({ dir: root, depth: 0 }));
    const found = [];
    let visited = 0;

    while (queue.length > 0 && visited < MAX_SEARCH_DIRS && Date.now() <= deadline) {
        const { dir, depth } = queue.shift();
        visited += 1;

        let entries;
        try {
            entries = await fsPromises.readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (depth >= MAX_SEARCH_DEPTH) continue;
                if (entry.name.startsWith('.') || SEARCH_IGNORED_DIRS.has(entry.name)) continue;
                queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
                continue;
            }
            if (entry.name.toLowerCase() !== target) continue;

            const full = path.join(dir, entry.name);
            let size = null;
            let mtime = null;
            try {
                const stats = await fsPromises.stat(full);
                size = stats.size;
                mtime = stats.mtimeMs;
            } catch {
                continue;
            }
            found.push({ path: full, name: entry.name, size, mtime });
            if (found.length >= limit) {
                return found;
            }
        }
    }

    return found;
}

/**
 * Request-facing wrapper: picks the roots the caller is allowed to read from and
 * delegates the actual resolution.
 */
export function resolveProjectFilePath({ filePath, projectRoot, user, allowSearch = true }) {
    return resolveAgainstRoots({
        filePath,
        projectRoot,
        fallbackRoots: () => getSearchRoots(user, path.resolve(projectRoot)),
        isAdmin: user?.role === 'admin',
        allowSearch,
    });
}

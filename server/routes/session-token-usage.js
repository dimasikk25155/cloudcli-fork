// GET /api/projects/:projectId/sessions/:sessionId/token-usage — moved out of
// server/index.js so the route and its test share one chain: the session
// access guard, then the handler. index.js mounts it behind authenticateToken.
import fs, { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';

import Database from 'better-sqlite3';

import { getOpenCodeDatabasePath } from '@/shared/utils.js';
import { getContextWindow } from '@/shared/token-pricing.js';
import { getSessionCostSnapshot, snapshotToComposerBudget } from '@/shared/session-usage.js';
import { requireSessionAccess } from '@/shared/require-session-access.js';

import { projectsDb, sessionsDb } from '../modules/database/index.js';
import { readClaudeContextBudget } from '../shared/context-budget.js';
import { readCodexSessionBudget } from '../modules/providers/index.js';

// Get token usage for a specific session. `projectId` is the DB primary key;
// the Claude branch below resolves it to an absolute path via the DB.
export async function sessionTokenUsageHandler(req, res) {
    try {
        const { projectId, sessionId } = req.params;
        const homeDir = os.homedir();

        // Allow only safe characters in sessionId
        const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
        if (!safeSessionId || safeSessionId !== String(sessionId)) {
            return res.status(400).json({ error: 'Invalid sessionId' });
        }

        // Provider artifacts on disk (JSONL file names, OpenCode sqlite rows)
        // are keyed by the provider-native session id, while the caller sends
        // the app-facing id. Resolve provider and id mapping from the indexed
        // session row so the frontend does not choose provider-specific paths.
        const sessionRow = sessionsDb.getSessionById(safeSessionId);
        if (!sessionRow) {
            return res.status(404).json({ error: 'Session not found', sessionId: safeSessionId });
        }

        const provider = sessionRow.provider || 'claude';
        const providerNativeSessionId = sessionRow?.provider_session_id || safeSessionId;

        // Handle Cursor sessions - they use SQLite and don't have token usage info
        if (provider === 'cursor') {
            return res.json({
                used: 0,
                total: 0,
                inputTokens: 0,
                outputTokens: 0,
                breakdown: { input: 0, output: 0 },
                unsupported: true,
                message: 'Token usage tracking not available for Cursor sessions'
            });
        }

        if (provider === 'grok') {
            const snapshot = await getSessionCostSnapshot(providerNativeSessionId, {
                projectPath: sessionRow.project_path,
            });
            if (!snapshot) {
                return res.status(404).json({ error: 'Grok session usage not found', sessionId: safeSessionId });
            }
            return res.json(snapshotToComposerBudget(snapshot));
        }

        if (provider === 'opencode') {
            const dbPath = getOpenCodeDatabasePath();
            if (!fs.existsSync(dbPath)) {
                return res.status(404).json({ error: 'OpenCode database not found' });
            }

            const db = new Database(dbPath, { readonly: true, fileMustExist: true });
            try {
                const columns = db.prepare('PRAGMA table_info(session)').all();
                const columnNames = new Set(columns.map((column) => column.name));
                const requiredColumns = ['tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write'];
                if (!requiredColumns.every((column) => columnNames.has(column))) {
                    return res.json({
                        used: 0,
                        inputTokens: 0,
                        outputTokens: 0,
                        breakdown: { input: 0, output: 0 },
                        unsupported: true,
                        message: 'Token usage tracking is not available in this OpenCode database schema'
                    });
                }

                const row = db.prepare(`
                    SELECT
                        tokens_input AS inputTokens,
                        tokens_output AS outputTokens,
                        tokens_reasoning AS reasoningTokens,
                        tokens_cache_read AS cacheReadTokens,
                        tokens_cache_write AS cacheWriteTokens
                    FROM session
                    WHERE id = ?
                `).get(providerNativeSessionId);

                if (!row) {
                    return res.status(404).json({ error: 'OpenCode session not found', sessionId: safeSessionId });
                }

                const inputTokens = Number(row.inputTokens || 0) + Number(row.cacheReadTokens || 0);
                const outputTokens = Number(row.outputTokens || 0);
                const totalUsed = Number(row.inputTokens || 0)
                    + outputTokens
                    + Number(row.reasoningTokens || 0)
                    + Number(row.cacheReadTokens || 0)
                    + Number(row.cacheWriteTokens || 0);

                return res.json({
                    used: totalUsed,
                    inputTokens,
                    outputTokens,
                    breakdown: {
                        input: inputTokens,
                        output: outputTokens
                    }
                });
            } finally {
                db.close();
            }
        }

        // Handle Codex sessions
        if (provider === 'codex') {
            const codexSessionsDir = path.join(homeDir, '.codex', 'sessions');

            // Find the session file by searching for the session ID
            const findSessionFile = async (dir) => {
                try {
                    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            const found = await findSessionFile(fullPath);
                            if (found) return found;
                        } else if (entry.name.includes(providerNativeSessionId) && entry.name.endsWith('.jsonl')) {
                            return fullPath;
                        }
                    }
                } catch (error) {
                    // Skip directories we can't read
                }
                return null;
            };

            const sessionFilePath = sessionRow.jsonl_path || await findSessionFile(codexSessionsDir);

            if (!sessionFilePath) {
                return res.status(404).json({ error: 'Codex session file not found', sessionId: safeSessionId });
            }

            try {
                return res.json(await readCodexSessionBudget(sessionFilePath));
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return res.status(404).json({ error: 'Session file not found', path: sessionFilePath });
                }
                throw error;
            }
        }

        // Handle Claude sessions (default)
        // Resolve the project path through the DB using the caller-supplied
        // `projectId`. Legacy code here called extractProjectDirectory with a
        // folder-encoded project name; the migration centralizes that lookup
        // in the projects table.
        const projectPath = await projectsDb.getProjectPathById(projectId);
        if (!projectPath) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Construct the JSONL file path
        // Claude stores session files in ~/.claude/projects/[encoded-project-path]/[session-id].jsonl
        // The encoding replaces any non-alphanumeric character (except -) with -
        const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
        const projectDir = path.join(homeDir, '.claude', 'projects', encodedPath);

        // Prefer the indexed transcript path (already produced by the trusted
        // session synchronizer); fall back to the conventional location
        // derived from the provider-native session id.
        let jsonlPath = sessionRow?.jsonl_path;
        if (!jsonlPath) {
            jsonlPath = path.join(projectDir, `${providerNativeSessionId}.jsonl`);

            // Constrain the constructed path to projectDir (the id is
            // caller-influenced in this fallback branch).
            const rel = path.relative(path.resolve(projectDir), path.resolve(jsonlPath));
            if (rel.startsWith('..') || path.isAbsolute(rel)) {
                return res.status(400).json({ error: 'Invalid path' });
            }
        }

        // Read and parse the JSONL file
        let fileContent;
        try {
            fileContent = await fsPromises.readFile(jsonlPath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'Session file not found', path: jsonlPath });
            }
            throw error; // Re-throw other errors to be caught by outer try-catch
        }
        const lines = fileContent.trim().split('\n');

        let budget = { used: null };
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const parsed = readClaudeContextBudget(JSON.parse(lines[i]));
                if (parsed) { budget = parsed; break; }
            } catch { /* Skip malformed rows. */ }
        }
        const parsedContextWindow = Number(process.env.CONTEXT_WINDOW);
        res.json({ ...budget, total: parsedContextWindow > 0 ? parsedContextWindow : getContextWindow(budget.model) });
    } catch (error) {
        console.error('Error reading session token usage:', error);
        res.status(500).json({ error: 'Failed to read session token usage' });
    }
}

/** Guard + handler, in this order; index.js and the test mount exactly this. */
export const sessionTokenUsageRoute = [requireSessionAccess, sessionTokenUsageHandler];

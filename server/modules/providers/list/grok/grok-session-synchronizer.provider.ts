import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import {
  GROK_UNTITLED_SESSION_TITLE,
  readGrokFirstUserText,
  resolveGrokSessionTitle,
} from '@/modules/providers/list/grok/grok-session-title.js';
import {
  findFilesRecursivelyCreatedAfter,
  getGrokHome,
  readObjectRecord,
} from '@/shared/utils.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  createdAt?: string;
  updatedAt?: string;
};

const HISTORY_FILE = 'chat_history.jsonl';

/**
 * Session indexer for Grok Build CLI transcripts.
 *
 * Layout (grok 1.0.5):
 *   ~/.grok/sessions/<url-encoded cwd>/<sessionId>/
 *     summary.json         — { info:{id,cwd}, session_summary, created_at,
 *                              updated_at, current_model_id, ... }
 *     chat_history.jsonl   — the conversation (indexed file)
 *     updates.jsonl, events.jsonl, prompt_context.json, system_prompt.txt
 * The directory name above the session is the workspace path, percent-encoded
 * (e.g. `%2Ftmp` for /tmp), but summary.json carries the decoded cwd, so the
 * encoding never has to be reversed here.
 */
export class GrokSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'grok' as const;

  private sessionsRoot(): string {
    return path.join(getGrokHome(), 'sessions');
  }

  /**
   * Scans ~/.grok/sessions and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const files = (await findFilesRecursivelyCreatedAfter(this.sessionsRoot(), '.jsonl', since ?? null))
      .filter((filePath) => path.basename(filePath) === HISTORY_FILE);

    let processed = 0;
    for (const filePath of files) {
      const parsed = await this.processSessionFile(filePath);
      if (!parsed) {
        continue;
      }

      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        parsed.createdAt,
        parsed.updatedAt,
        filePath,
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Parses and upserts one Grok chat_history.jsonl file (watcher entrypoint).
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (path.basename(filePath) !== HISTORY_FILE) {
      return null;
    }

    const parsed = await this.processSessionFile(filePath);
    if (!parsed) {
      return null;
    }

    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      parsed.createdAt,
      parsed.updatedAt,
      filePath,
    );
  }

  /**
   * Extracts session metadata from one chat_history.jsonl path via its sibling
   * summary.json. Returns null when the summary is missing/unreadable — a
   * session the CLI is still initializing gets picked up on a later scan.
   */
  private async processSessionFile(filePath: string): Promise<ParsedSession | null> {
    const sessionDir = path.dirname(filePath);
    const sessionId = path.basename(sessionDir);
    if (!sessionId) {
      return null;
    }

    let summary: Record<string, unknown> = {};
    try {
      summary = readObjectRecord(JSON.parse(await readFile(path.join(sessionDir, 'summary.json'), 'utf8')) as unknown) ?? {};
    } catch {
      return null;
    }

    const info = readObjectRecord(summary.info) ?? {};
    const projectPath = typeof info.cwd === 'string' && info.cwd.trim() ? info.cwd : sessionDir;

    // Only index sessions the app actually started. A bare `grok -p` run from a
    // terminal writes the same on-disk shape but has no app row, so without
    // this guard it would pollute the sidebar. The app names the session id up
    // front (`grok -s <uuid>`), so the mapped row normally exists already;
    // the pending claim mirrors the other synchronizers for the race where the
    // watcher wins against the websocket binding.
    const mapped = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    if (!mapped) {
      const pending = sessionsDb.findLatestPendingAppSession(this.provider, projectPath);
      if (!pending) {
        return null;
      }
      sessionsDb.assignProviderSessionId(pending.session_id, sessionId);
    }

    // Grok CLI auto-titles in English. Name the chat from the first words of
    // the first user turn unless the user already renamed it (UI or /rename).
    const existing = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    const existingName = existing?.custom_name;
    const cliTitle = typeof summary.session_summary === 'string' && summary.session_summary.trim()
      ? summary.session_summary.trim()
      : undefined;
    const firstUserText = await readGrokFirstUserText(filePath);
    const sessionName = resolveGrokSessionTitle({
      existingName,
      cliTitle,
      firstUserText,
      titleIsManual: summary.title_is_manual === true,
    }) || GROK_UNTITLED_SESSION_TITLE;

    return {
      sessionId,
      projectPath,
      sessionName,
      createdAt: typeof summary.created_at === 'string' ? summary.created_at : undefined,
      updatedAt: typeof summary.updated_at === 'string' ? summary.updated_at : undefined,
    };
  }
}

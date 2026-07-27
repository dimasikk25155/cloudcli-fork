import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import {
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readObjectRecord,
} from '@/shared/utils.js';
import { getKimiCodeHome } from '@/shared/utils.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  createdAt?: string;
  updatedAt?: string;
};

const WIRE_SUFFIX = path.join('agents', 'main', 'wire.jsonl');
const UNTITLED = 'Untitled Kimi Session';

/**
 * Session indexer for Kimi Code CLI transcripts.
 *
 * Layout (kimi-code 0.29.0):
 *   ~/.kimi-code/sessions/<workDirKey>/<sessionId>/
 *     state.json              — { title, workDir, createdAt, updatedAt, ... }
 *     agents/main/wire.jsonl  — the main agent's event stream (indexed file)
 *     agents/<subagentId>/    — subagent streams (skipped, like the other
 *                               synchronizers skip subagent transcripts)
 * A sibling session_index.jsonl exists too, but state.json already carries
 * everything needed, so each session is indexed from its own directory.
 */
export class KimiSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'kimi' as const;

  private sessionsRoot(): string {
    return path.join(getKimiCodeHome(), 'sessions');
  }

  /**
   * Scans ~/.kimi-code/sessions and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const files = (await findFilesRecursivelyCreatedAfter(this.sessionsRoot(), '.jsonl', since ?? null))
      .filter((filePath) => filePath.endsWith(WIRE_SUFFIX));

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
   * Parses and upserts one Kimi wire.jsonl file (watcher entrypoint).
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith(WIRE_SUFFIX)) {
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
   * Extracts session metadata from one wire.jsonl path via its sibling
   * state.json. Returns null when the state file is missing/unreadable —
   * a session the CLI is still initializing gets picked up on a later scan.
   */
  private async processSessionFile(filePath: string): Promise<ParsedSession | null> {
    const sessionDir = path.dirname(path.dirname(path.dirname(filePath)));
    const sessionId = path.basename(sessionDir);
    if (!sessionId) {
      return null;
    }

    let state: Record<string, unknown> = {};
    try {
      state = readObjectRecord(JSON.parse(await readFile(path.join(sessionDir, 'state.json'), 'utf8'))) ?? {};
    } catch {
      return null;
    }

    const projectPath = typeof state.workDir === 'string' && state.workDir.trim()
      ? state.workDir
      : sessionDir;

    // Only index sessions the app actually started. A bare `kimi -p` run from a
    // terminal (or a test) writes the same on-disk shape but has no app row, so
    // without this guard it would pollute the sidebar. Kimi reports its session
    // id only in the FINAL meta line, so the watcher reaches here BEFORE the
    // websocket mapping binds it — the app row is still pending. We claim that
    // pending row now (mirrors the OpenCode synchronizer). If nothing maps and
    // nothing is pending for this project, it's an external session → skip.
    const mapped = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    if (!mapped) {
      const pending = sessionsDb.findLatestPendingAppSession(this.provider, projectPath);
      if (!pending) {
        return null;
      }
      sessionsDb.assignProviderSessionId(pending.session_id, sessionId);
    }

    // An existing app-set name (e.g. renamed in the UI) always wins over the
    // CLI's auto title; otherwise use the CLI title when it has one.
    const existing = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    const existingName = existing?.custom_name;
    const cliTitle = typeof state.title === 'string' && state.title.trim() ? state.title.trim() : undefined;
    const sessionName = existingName && existingName !== UNTITLED
      ? existingName
      : normalizeSessionName(cliTitle, UNTITLED);

    return {
      sessionId,
      projectPath,
      sessionName,
      createdAt: typeof state.createdAt === 'string' ? state.createdAt : undefined,
      updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : undefined,
    };
  }
}

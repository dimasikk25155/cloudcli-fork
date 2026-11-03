import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { codexHome } from '@/shared/codex-paths.js';
import { appConfigDb, sessionsDb } from '@/modules/database/index.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readTranscriptTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

import { generateTitle, resolveTitle, titleFacts, type TitleGenerator, type TitleState } from './codex-session-title.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/**
 * Session indexer for Codex transcript artifacts.
 */
export class CodexSessionSynchronizer implements IProviderSessionSynchronizer {
  constructor(private readonly titleGenerator: TitleGenerator = generateTitle, private readonly now = Date.now) {}

  private readonly titleChecks = new Map<string, { at: number; name: string }>();

  private readonly provider = 'codex' as const;
  private readonly codexHome = codexHome();

  /**
   * Scans ~/.codex/sessions and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const nameMap = await buildLookupMap(path.join(this.codexHome, 'session_index.jsonl'), 'id', 'thread_name');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(this.codexHome, 'sessions'),
      '.jsonl',
      since ?? null
    );

    let processed = 0;
    for (const filePath of files) {
      const parsed = await this.processSessionFile(filePath, nameMap);
      if (!parsed) {
        continue;
      }

      const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
        ?? sessionsDb.getSessionById(parsed.sessionId);
      if (existingSession) {
        // If session name is untitled and we now have a name, update it
        if (existingSession.custom_name === 'Untitled Codex Session' && parsed.sessionName && parsed.sessionName !== 'Untitled Codex Session') {
          sessionsDb.updateSessionCustomName(existingSession.session_id, parsed.sessionName);
        }
      }

      const timestamps = await readTranscriptTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Parses and upserts one Codex session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    const nameMap = await buildLookupMap(path.join(this.codexHome, 'session_index.jsonl'), 'id', 'thread_name');
    const parsed = await this.processSessionFile(filePath, nameMap);
    if (!parsed) {
      return null;
    }

    const timestamps = await readTranscriptTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath
    );
  }

  /**
   * Extracts session metadata from one Codex JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const payload = data.payload as Record<string, unknown> | undefined;
      const sessionId = typeof payload?.id === 'string' ? payload.id : undefined;
      const projectPath = typeof payload?.cwd === 'string' ? payload.cwd : undefined;

      if (!sessionId || !projectPath) {
        return null;
      }

      return {
        sessionId,
        projectPath,
        isSubagent: payload ? this.isSubagentSessionMeta(payload) : false,
      };
    });

    if (!parsed || parsed.isSubagent) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingName = existingSession?.custom_name;
    const checked = this.titleChecks.get(parsed.sessionId);
    if (existingName && checked?.name === existingName && this.now() - checked.at < 30_000) {
      return { ...parsed, sessionName: existingName };
    }
    const key = `codex-auto-title:${parsed.sessionId}`;
    let state: TitleState | null = null;
    try { state = JSON.parse(appConfigDb.get(key) || 'null'); } catch { /* No previous title owner. */ }
    const facts = titleFacts(await readFile(filePath, 'utf8'));
    const next = await resolveTitle(facts, existingName, state, this.titleGenerator);
    // A UI rename while the model was running wins over this completion.
    const latest = existingSession ? sessionsDb.getSessionById(existingSession.session_id)?.custom_name : existingName;
    if (latest !== existingName) return { ...parsed, sessionName: latest || undefined };
    if (next) appConfigDb.set(key, JSON.stringify(next));
    const sessionName = normalizeSessionName(next?.title || existingName || nameMap.get(parsed.sessionId), 'Untitled Codex Session');
    if (this.titleChecks.size >= 1000) this.titleChecks.delete(this.titleChecks.keys().next().value!);
    this.titleChecks.set(parsed.sessionId, { at: this.now(), name: sessionName });
    return { ...parsed, sessionName };
  }

  /**
   * Returns true when a session_meta payload belongs to a Codex sub-agent
   * thread (Codex >=0.144 collaboration spawn_agent, review, compact, etc.).
   * Sub-agent rollouts live in the same sessions tree as user sessions, so
   * they must be skipped here to stay out of the sidebar — the Codex
   * equivalent of the Claude synchronizer's subagent transcript skip.
   * Top-level sessions carry thread_source "user" and a string source
   * ("exec"/"cli"); sub-agents carry thread_source "subagent" and an object
   * source keyed by "subagent".
   */
  private isSubagentSessionMeta(payload: Record<string, unknown>): boolean {
    if (payload.thread_source === 'subagent') {
      return true;
    }

    const source = payload.source;
    return typeof source === 'object' && source !== null && 'subagent' in source;
  }

}

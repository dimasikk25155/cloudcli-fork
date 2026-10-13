/**
 * Vault-note suggestions (spec stories 44–48, decisions 11, 12, 20).
 *
 * Replaces the obsidian-memory Stop hook inside Neo3: instead of waking the
 * agent for one more turn at the end of every reply, Neo3 waits until a
 * session has gone quiet, hands its transcript to the local model (Windows
 * Ollama, free, outside the subscription) and shows the proposed note in the
 * session and in the «Ждут тебя» hub. Dima decides: «Записать» / «Не надо».
 *
 * Budget rules — the model must never be hammered:
 *   - the check runs every 10 minutes, only for sessions an admin ran;
 *   - a session is reviewed at most once (one row per session);
 *   - a failed review (model down, garbage answer) is retried on later ticks,
 *     3 attempts in total, then the session is given up on;
 *   - at most MAX_REVIEWS_PER_TICK model calls per tick, one at a time;
 *   - only sessions that went quiet within the last day are looked at.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  memorySuggestionsDb,
  sessionAttentionDb,
  sessionsDb,
  userDb,
  type MemorySuggestionRow,
  type SessionAttentionRow,
} from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import { completeJson, localLlmModel, type CompleteJsonOptions } from '@/shared/local-llm.js';
import { canUserAccessSession } from '@/shared/project-access.js';

import { hasWorkWorthNoting, isQuietStatus, type TranscriptMessage } from './quiet-session.js';
import { buildMemoryPrompt, buildTranscript, fixLinks, MEMORY_SYSTEM_PROMPT, parseNoteAnswer, relatedNotes } from './vault-note.js';
import { listProjectFolders, listVaultNotes, vaultDir as defaultVaultDir, VaultPathError, writeVaultNote } from './vault-writer.js';

export const MEMORY_CHECK_INTERVAL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;
export const MAX_REVIEWS_PER_TICK = 3;
/** Transcript reads per tick, model calls included (cheap, but not free). */
const MAX_HISTORY_READS_PER_TICK = 20;
/** Content-free WS frame; clients re-read `GET /api/memory-suggestions`. */
export const MEMORY_SUGGESTIONS_CHANGED = 'memory_suggestions_changed';

// The 9B model reads up to ~60K characters (~20–25K tokens of mixed
// Russian/English) — the window must hold that plus the answer.
const MODEL_NUM_CTX = 32_768;
const MODEL_MAX_TOKENS = 1_500;
const MODEL_TIMEOUT_MS = 180_000;

/** Statuses after which the session is never reviewed again. */
const SETTLED = new Set(['ready', 'writing', 'skipped', 'failed', 'written', 'dismissed']);

export type MemorySuggestionsUser = { id: number | string; role?: string | null };

export type MemorySuggestionItem = {
  id: number;
  sessionId: string;
  sessionTitle: string | null;
  projectName: string | null;
  title: string;
  folder: string;
  body: string;
  createdAt: string;
};

export type MemorySuggestionsDependencies = {
  fetchHistory?: (sessionId: string) => Promise<{ messages: TranscriptMessage[] }>;
  complete?: (options: CompleteJsonOptions) => Promise<unknown | null>;
  now?: () => Date;
  vaultDir?: () => string;
  broadcast?: (payload: Record<string, unknown>) => void;
};

export type WriteResult =
  | { status: 'ok'; path: string; relativePath: string }
  /** Another «Записать» of the same suggestion is creating the file right now. */
  | { status: 'forbidden' | 'not_found' | 'gone' | 'busy' }
  | { status: 'error'; message: string };

export type DismissResult = { status: 'ok' | 'forbidden' | 'not_found' | 'gone' };

async function defaultFetchHistory(sessionId: string): Promise<{ messages: TranscriptMessage[] }> {
  const { sessionsService } = await import('@/modules/providers/services/sessions.service.js');
  return sessionsService.fetchHistory(sessionId, {});
}

function defaultBroadcast(payload: Record<string, unknown>): void {
  const frame = JSON.stringify(payload);
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(frame);
    }
  });
}

function isAdmin(user: MemorySuggestionsUser): boolean {
  return user.role === 'admin';
}

function isAdminUserId(userId: number | null): boolean {
  if (userId === null) {
    return false;
  }
  return userDb.getUserById(userId)?.role === 'admin';
}

export function createMemorySuggestionsService(dependencies: MemorySuggestionsDependencies = {}) {
  const fetchHistory = dependencies.fetchHistory ?? defaultFetchHistory;
  const complete = dependencies.complete ?? completeJson;
  const now = dependencies.now ?? (() => new Date());
  const getVaultDir = dependencies.vaultDir ?? defaultVaultDir;
  const broadcast = dependencies.broadcast ?? defaultBroadcast;
  let running: Promise<{ reviewed: number }> | null = null;

  function notifyChanged(sessionId: string): void {
    try {
      broadcast({ kind: MEMORY_SUGGESTIONS_CHANGED, sessionId, timestamp: now().toISOString() });
    } catch {
      // A dead socket must not break the review loop.
    }
  }

  function save(
    status: SessionAttentionRow,
    fields: Partial<Pick<MemorySuggestionRow, 'status' | 'attempts' | 'title' | 'folder' | 'body' | 'last_error'>>,
  ): void {
    memorySuggestionsDb.save({
      session_id: status.session_id,
      user_id: status.user_id,
      status: fields.status ?? 'pending',
      attempts: fields.attempts ?? 0,
      source_updated_at: status.updated_at,
      title: fields.title ?? null,
      folder: fields.folder ?? null,
      body: fields.body ?? null,
      written_path: null,
      last_error: fields.last_error ?? null,
      now: now().toISOString(),
    });
  }

  /** Quiet admin sessions that still need a (first or repeated) review, newest first. */
  function findCandidates(): Array<{ status: SessionAttentionRow; previous: MemorySuggestionRow | null }> {
    const at = now();
    const candidates: Array<{ status: SessionAttentionRow; previous: MemorySuggestionRow | null }> = [];
    for (const status of sessionAttentionDb.listByStates(['done'])) {
      if (!isQuietStatus({ state: status.state, updatedAt: status.updated_at }, at)) continue;
      const previous = memorySuggestionsDb.getBySession(status.session_id);
      if (previous && SETTLED.has(previous.status)) continue;
      // Not worth a look last time and nothing happened since: skip the transcript read.
      if (previous?.status === 'ineligible' && previous.source_updated_at >= status.updated_at) continue;
      if (!isAdminUserId(status.user_id)) continue;
      candidates.push({ status, previous });
    }
    return candidates.sort((a, b) => b.status.updated_at.localeCompare(a.status.updated_at));
  }

  async function review(status: SessionAttentionRow, previous: MemorySuggestionRow | null): Promise<boolean> {
    const attempts = (previous?.status === 'pending' ? previous.attempts : 0) + 1;
    const failed = (reason: string) => {
      save(status, { status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, last_error: reason });
    };

    let messages: TranscriptMessage[];
    try {
      ({ messages } = await fetchHistory(status.session_id));
    } catch {
      failed('history unavailable');
      return true;
    }
    if (!hasWorkWorthNoting(messages)) {
      save(status, { status: 'ineligible' });
      return false;
    }

    const root = getVaultDir();
    const projectFolders = await listProjectFolders(root);
    const today = now().toISOString().slice(0, 10);
    const projectName = path.basename(sessionsDb.getSessionById(status.session_id)?.project_path ?? '') || null;
    const knownNotes = await listVaultNotes(root);
    const related = relatedNotes(knownNotes, projectName);
    const raw = await complete({
      system: MEMORY_SYSTEM_PROMPT,
      prompt: buildMemoryPrompt(buildTranscript(messages), { today, projectFolders, projectName, relatedNotes: related }),
      model: localLlmModel('memory'),
      timeoutMs: MODEL_TIMEOUT_MS,
      maxTokens: MODEL_MAX_TOKENS,
      numCtx: MODEL_NUM_CTX,
      temperature: 0.2,
    });
    if (raw === null) {
      failed('model unavailable');
      return true;
    }
    const parsed = parseNoteAnswer(raw, { today, projectFolders, knownNotes, relatedNotes: related });
    if (parsed.kind === 'invalid') {
      failed(`invalid answer: ${parsed.reason}`);
      return true;
    }
    if (parsed.kind === 'skip') {
      save(status, { status: 'skipped', attempts });
      return true;
    }
    save(status, { status: 'ready', attempts, title: parsed.title, folder: parsed.folder, body: parsed.body });
    notifyChanged(status.session_id);
    return true;
  }

  async function checkOnce(): Promise<{ reviewed: number }> {
    let reviewed = 0;
    let reads = 0;
    for (const { status, previous } of findCandidates()) {
      if (reviewed >= MAX_REVIEWS_PER_TICK || reads >= MAX_HISTORY_READS_PER_TICK) break;
      reads += 1;
      try {
        if (await review(status, previous)) reviewed += 1;
      } catch (error) {
        console.warn('[memory-suggestions] review failed:', (error as Error)?.message || error);
      }
    }
    return { reviewed };
  }

  return {
    /** One background tick. Overlapping calls share the running tick. */
    runCheck(): Promise<{ reviewed: number }> {
      if (!running) {
        running = checkOnce().finally(() => {
          running = null;
        });
      }
      return running;
    },

    /** Proposed notes the user may act on. Admin-only feature: others get none. */
    list(user: MemorySuggestionsUser, filter: { sessionId?: string } = {}): MemorySuggestionItem[] {
      if (!isAdmin(user)) {
        return [];
      }
      return memorySuggestionsDb
        .listReady(filter.sessionId)
        .filter((row) => canUserAccessSession(user, row.session_id))
        .map((row) => ({
          id: row.id,
          sessionId: row.session_id,
          sessionTitle: row.session_name,
          projectName: row.project_path ? path.basename(row.project_path) : null,
          title: row.title ?? '',
          folder: row.folder ?? '',
          body: row.body ?? '',
          createdAt: row.updated_at,
        }));
    },

    /**
     * «Записать»: admin only. The row is claimed atomically (ready → writing)
     * before the file is created, so a second tap or tab cannot create a
     * second file and «Не надо» cannot slip in mid-write.
     */
    async write(user: MemorySuggestionsUser, id: number): Promise<WriteResult> {
      if (!isAdmin(user)) {
        return { status: 'forbidden' };
      }
      const writtenAnswer = async (row: MemorySuggestionRow): Promise<WriteResult> => {
        const root = await fs.promises.realpath(getVaultDir()).catch(() => getVaultDir());
        return { status: 'ok', path: path.join(root, ...row.written_path!.split('/')), relativePath: row.written_path! };
      };
      const row = memorySuggestionsDb.getById(id);
      if (!row) {
        return { status: 'not_found' };
      }
      if (row.status === 'written' && row.written_path) {
        // A repeated tap (or a second tab) gets the same answer, not a second file.
        return writtenAnswer(row);
      }
      if (!row.title || !row.body || !memorySuggestionsDb.transition(id, 'ready', 'writing', now().toISOString())) {
        const current = memorySuggestionsDb.getById(id);
        if (current?.status === 'written' && current.written_path) return writtenAnswer(current);
        return { status: current?.status === 'writing' ? 'busy' : 'gone' };
      }
      let written;
      try {
        const knownNotes = await listVaultNotes(getVaultDir());
        const projectPath = sessionsDb.getSessionById(row.session_id)?.project_path;
        const related = relatedNotes(knownNotes, projectPath ? path.basename(projectPath) : null);
        const body = fixLinks(row.body, knownNotes, related);
        written = await writeVaultNote({ vaultDir: getVaultDir(), folder: row.folder || 'wiki/synthesis', title: row.title, body });
      } catch (error) {
        memorySuggestionsDb.transition(id, 'writing', 'ready', now().toISOString());
        return {
          status: 'error',
          message: error instanceof VaultPathError ? error.message : 'Не удалось записать заметку',
        };
      }
      memorySuggestionsDb.transition(id, 'writing', 'written', now().toISOString(), written.relativePath);
      notifyChanged(row.session_id);
      return { status: 'ok', path: written.absolutePath, relativePath: written.relativePath };
    },

    /** «Не надо»: admin only (same rule as the list); the suggestion goes away for good. */
    dismiss(user: MemorySuggestionsUser, id: number): DismissResult {
      if (!isAdmin(user)) {
        return { status: 'forbidden' };
      }
      const row = memorySuggestionsDb.getById(id);
      if (!row) {
        return { status: 'not_found' };
      }
      if (!canUserAccessSession(user, row.session_id)) {
        return { status: 'forbidden' };
      }
      // Only from ready: a note being written (or written) cannot be dismissed.
      if (!memorySuggestionsDb.transition(id, 'ready', 'dismissed', now().toISOString())) {
        return { status: 'gone' };
      }
      notifyChanged(row.session_id);
      return { status: 'ok' };
    },

    /** After a restart: writes that never finished go back to ready. */
    recoverInterruptedWrites(): number {
      return memorySuggestionsDb.resetInterruptedWrites(now().toISOString());
    },

    /** True when the vault folder exists — no vault (client installs), no reviews. */
    hasVault(): boolean {
      try {
        return fs.statSync(getVaultDir()).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

export type MemorySuggestionsService = ReturnType<typeof createMemorySuggestionsService>;

export const memorySuggestions = createMemorySuggestionsService();

/**
 * Starts the 10-minute background check (spec decision 12). Skipped entirely
 * with `NEO3_MEMORY_SUGGESTIONS=off`, and a tick does nothing while the vault
 * folder is missing (client installs have none). Returns a stop function.
 */
export function startMemorySuggestionsLoop(
  service: MemorySuggestionsService = memorySuggestions,
  { intervalMs = MEMORY_CHECK_INTERVAL_MS, firstRunMs = 2 * 60_000 } = {},
): () => void {
  if ((process.env.NEO3_MEMORY_SUGGESTIONS || '').trim().toLowerCase() === 'off') {
    return () => {};
  }
  service.recoverInterruptedWrites();
  const tick = () => {
    if (!service.hasVault()) return;
    service.runCheck().catch((error) => {
      console.warn('[memory-suggestions] check failed:', error?.message || error);
    });
  };
  const first = setTimeout(tick, firstRunMs);
  const timer = setInterval(tick, intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

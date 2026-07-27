import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { sessionsDb } from '../modules/database/index.js';

/**
 * Per-session token history, grouped by Moscow day, for the "Token Usage"
 * dashboard. Reads the same Claude transcripts (`~/.claude/projects/**\/*.jsonl`)
 * the session providers already parse, and sums the per-turn `message.usage`
 * counters into a single "burn" number per session.
 *
 * The "tokens" metric here is deliberately the full API throughput
 * (input + output + cache-creation + cache-read), matching how `ccusage`
 * attributes load to a session. This is larger than the single context-window
 * snapshot `/cost` shows, but it is the honest "how heavy was this session"
 * number the dashboard is meant to surface.
 */

export type SessionUsage = {
  project: string;
  projectPath: string | null;
  sessionId: string;
  title: string | null;
  tokens: number;
  output: number;
  model: string | null;
  lastActivity: string;
};

/**
 * The human session title the sidebar shows, resolved from the DB `custom_name`
 * the session synchronizer already persists (AI/first-message title or a manual
 * rename). Placeholder/untitled names collapse to null so the UI can fall back
 * to the project name. Never throws — an unready DB just yields no title.
 */
function resolveSessionTitle(diskSessionId: string): string | null {
  try {
    const row =
      sessionsDb.getSessionByProviderSessionId(diskSessionId) ??
      sessionsDb.getSessionById(diskSessionId);
    const name = row?.custom_name?.trim();
    if (!name || name === 'Untitled Claude Session' || name === diskSessionId) {
      return null;
    }
    return name;
  } catch {
    return null;
  }
}

export type UsageHistoryDay = {
  day: string;
  tokens: number;
  sessions: SessionUsage[];
};

const CACHE_TTL_MS = 60_000;
// Only scan sessions touched within this window; older transcripts stay off
// the hot path so a request never walks the entire history on disk.
const MAX_AGE_DAYS = 30;

let cached: { at: number; days: UsageHistoryDay[] } | null = null;

function claudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** YYYY-MM-DD in Moscow wall-clock for an ISO timestamp. */
function moscowDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  } catch {
    return 'unknown';
  }
}

type SessionAccumulator = {
  tokens: number;
  output: number;
  model: string | null;
  projectPath: string | null;
  lastActivity: string | null;
};

/**
 * Streams one transcript file and folds every `message.usage` row into a single
 * burn total. Also captures the working directory (real project path) and the
 * most recent activity timestamp/model seen in the file.
 */
async function scanSessionFile(filePath: string): Promise<SessionAccumulator> {
  const acc: SessionAccumulator = {
    tokens: 0,
    output: 0,
    model: null,
    projectPath: null,
    lastActivity: null,
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line);

      if (typeof entry.cwd === 'string' && entry.cwd) {
        acc.projectPath = entry.cwd;
      }

      const usage = entry.message?.usage;
      if (usage) {
        acc.tokens +=
          (usage.input_tokens || 0) +
          (usage.output_tokens || 0) +
          (usage.cache_creation_input_tokens || 0) +
          (usage.cache_read_input_tokens || 0);
        acc.output += usage.output_tokens || 0;

        if (typeof entry.message?.model === 'string' && entry.message.model !== '<synthetic>') {
          acc.model = entry.message.model;
        }
        if (typeof entry.timestamp === 'string') {
          acc.lastActivity = entry.timestamp;
        }
      }
    } catch {
      // Skip malformed lines that can happen during concurrent writes.
    }
  }

  return acc;
}

/**
 * Builds the day → sessions token history, newest day first and heaviest
 * session first within each day. Cached for a minute so repeated modal opens
 * don't re-walk the transcripts.
 */
export async function getSessionUsageHistory(): Promise<UsageHistoryDay[]> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.days;
  }

  const dir = claudeProjectsDir();
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
  const sessions: SessionUsage[] = [];

  let projectDirs: string[] = [];
  try {
    projectDirs = await fsp.readdir(dir);
  } catch {
    // No transcripts on this host yet — an empty history is a valid answer.
    cached = { at: Date.now(), days: [] };
    return [];
  }

  for (const slug of projectDirs) {
    const projectDir = path.join(dir, slug);
    let files: string[] = [];
    try {
      const stat = await fsp.stat(projectDir);
      if (!stat.isDirectory()) {
        continue;
      }
      files = await fsp.readdir(projectDir);
    } catch {
      continue;
    }

    for (const file of files) {
      // Only main session transcripts; `agent-*.jsonl` are sub-agent streams
      // keyed by agent id, not by session, so they don't map to a session row.
      if (!file.endsWith('.jsonl') || file.startsWith('agent-')) {
        continue;
      }

      const filePath = path.join(projectDir, file);
      let mtimeMs = 0;
      try {
        mtimeMs = (await fsp.stat(filePath)).mtimeMs;
      } catch {
        continue;
      }
      if (mtimeMs < cutoff) {
        continue;
      }

      let acc: SessionAccumulator;
      try {
        acc = await scanSessionFile(filePath);
      } catch {
        continue;
      }

      if (acc.tokens <= 0) {
        continue;
      }

      const projectPath = acc.projectPath;
      const project = projectPath
        ? path.basename(projectPath)
        // Fall back to the encoded folder slug when the transcript never
        // recorded a cwd (older/edge transcripts).
        : slug.replace(/^-/, '').split('-').pop() || slug;

      const sessionId = file.replace(/\.jsonl$/, '');
      sessions.push({
        project,
        projectPath,
        sessionId,
        title: resolveSessionTitle(sessionId),
        tokens: acc.tokens,
        output: acc.output,
        model: acc.model,
        lastActivity: acc.lastActivity ?? new Date(mtimeMs).toISOString(),
      });
    }
  }

  const byDay = new Map<string, SessionUsage[]>();
  for (const session of sessions) {
    const day = moscowDay(session.lastActivity);
    const bucket = byDay.get(day);
    if (bucket) {
      bucket.push(session);
    } else {
      byDay.set(day, [session]);
    }
  }

  const days: UsageHistoryDay[] = [...byDay.entries()]
    .map(([day, daySessions]) => ({
      day,
      tokens: daySessions.reduce((sum, session) => sum + session.tokens, 0),
      sessions: daySessions.sort((a, b) => b.tokens - a.tokens),
    }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));

  cached = { at: Date.now(), days };
  return days;
}

// ---------------------------------------------------------------------------
// Per-session cost snapshot (powers the `/cost` modal)
// ---------------------------------------------------------------------------

/**
 * Honest per-session token numbers read straight from the session transcript
 * on disk. The composer chip only sees the LAST streamed `token_budget` event
 * (and only while the session is actively running), so reopening an old chat
 * used to show `0 / Недоступно` and the catalog-default model. This snapshot
 * covers the engines whose transcripts live on this host:
 *   - claude engine (also Kimi models spawned through it) → ~/.claude/projects/<enc>/<sid>.jsonl
 *   - kimi CLI                                          → ~/.kimi-code/sessions/<wd>/session_<sid>/agents/main/wire.jsonl
 */
export type SessionCostSnapshot = {
  /** Raw model id from the transcript (`claude-opus-4-8`, `k3`, `kimi-for-coding`). */
  model: string | null;
  /** Full-session burn: direct input + cache read + cache creation. */
  inputTokens: number;
  /** Full-session burn: generated output. */
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** inputTokens + outputTokens — matches the "burn" metric of the history view. */
  totalTokens: number;
  /** in+out of the LAST usage row — how full the context window is right now. */
  contextTokens: number | null;
  transcriptPath: string;
};

function kimiSessionsDir(): string {
  return path.join(os.homedir(), '.kimi-code', 'sessions');
}

/**
 * Locates the transcript file for a session without trusting any single id
 * space: the app-facing session id and the provider-native id are both tried,
 * first via the DB index, then by probing the conventional on-disk layouts.
 */
async function findSessionTranscript(
  sessionId: string,
  projectPath?: string | null,
): Promise<string | null> {
  const candidates = new Set<string>([sessionId]);

  try {
    const row = sessionsDb.resolveSessionRowForOverride(sessionId);
    if (row?.provider_session_id) {
      candidates.add(row.provider_session_id);
    }
    if (row?.jsonl_path && fs.existsSync(row.jsonl_path)) {
      return row.jsonl_path;
    }
    if (row?.project_path && !projectPath) {
      projectPath = row.project_path;
    }
  } catch {
    // An unready DB must not break the modal — fall through to disk probing.
  }

  // Claude engine: ~/.claude/projects/<encoded cwd>/<session>.jsonl
  if (projectPath) {
    const encoded = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
    for (const id of candidates) {
      const candidate = path.join(claudeProjectsDir(), encoded, `${id}.jsonl`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  // Claude engine, project unknown: probe every project folder (cheap stat per dir).
  try {
    for (const slug of await fsp.readdir(claudeProjectsDir())) {
      for (const id of candidates) {
        const candidate = path.join(claudeProjectsDir(), slug, `${id}.jsonl`);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // No claude transcripts on this host.
  }

  // Kimi CLI: ~/.kimi-code/sessions/<wd_*>/session_<id>/agents/main/wire.jsonl
  try {
    for (const wdDir of await fsp.readdir(kimiSessionsDir())) {
      for (const id of candidates) {
        const candidate = path.join(kimiSessionsDir(), wdDir, `session_${id}`, 'agents', 'main', 'wire.jsonl');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // No kimi transcripts on this host.
  }

  return null;
}

const readUsageNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Streams one transcript and folds every usage row into full-session burn
 * totals. Handles both usage schemas:
 *   claude:  message.usage = { input_tokens, output_tokens, cache_*_input_tokens }
 *   kimi:    event.usage   = { inputOther, output, inputCacheRead, inputCacheCreation } (on step.end)
 * and both model notations (claude `message.model`, kimi `llm.request` → model).
 */
export async function getSessionCostSnapshot(
  sessionId: string | null | undefined,
  options: { projectPath?: string | null } = {},
): Promise<SessionCostSnapshot | null> {
  if (!sessionId || typeof sessionId !== 'string') {
    return null;
  }

  const transcriptPath = await findSessionTranscript(sessionId, options.projectPath);
  if (!transcriptPath) {
    return null;
  }

  const snapshot: Omit<SessionCostSnapshot, 'transcriptPath'> = {
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    contextTokens: null,
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(transcriptPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const usage = entry?.message?.usage
      ?? (entry?.event?.type === 'step.end' ? entry.event.usage : null);
    if (usage && typeof usage === 'object') {
      const directInput = readUsageNumber(usage.input_tokens ?? usage.inputTokens ?? usage.inputOther);
      const cacheRead = readUsageNumber(
        usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cacheReadTokens ?? usage.inputCacheRead,
      );
      const cacheCreation = readUsageNumber(
        usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? usage.cacheCreationTokens ?? usage.inputCacheCreation,
      );
      const output = readUsageNumber(usage.output_tokens ?? usage.outputTokens ?? usage.output);

      snapshot.inputTokens += directInput + cacheRead + cacheCreation;
      snapshot.outputTokens += output;
      snapshot.cacheReadTokens += cacheRead;
      snapshot.cacheCreationTokens += cacheCreation;
      snapshot.contextTokens = directInput + cacheRead + cacheCreation + output;
    }

    // `<synthetic>` marks non-LLM placeholder rows in claude transcripts.
    const messageModel = entry?.message?.model;
    if (typeof messageModel === 'string' && messageModel && messageModel !== '<synthetic>') {
      snapshot.model = messageModel;
    } else if (entry?.type === 'llm.request' && typeof entry.model === 'string' && entry.model) {
      snapshot.model = entry.model;
    }
  }

  snapshot.totalTokens = snapshot.inputTokens + snapshot.outputTokens;
  return { ...snapshot, transcriptPath };
}

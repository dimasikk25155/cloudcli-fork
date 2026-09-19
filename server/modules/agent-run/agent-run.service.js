// One place that answers "run this prompt in this project, nobody is watching".
//
// Pipelines, schedules and the Telegram bot all need exactly that, and all three
// would otherwise grow their own copy of the provider dispatch in routes/agent.js.
// The dispatch itself is deliberately identical to that route — same engines,
// same bypassPermissions posture — because an unattended run has no human to
// answer a permission prompt.

import { projectsDb, userDb, userProjectAccessDb, providerPreferencesDb } from '../database/index.js';
import { queryClaudeSDK } from '../../claude-sdk.js';
import { spawnCursor } from '../../cursor-cli.js';
import { queryCodex } from '../../openai-codex.js';
import { spawnOpenCode } from '../../opencode-cli.js';
import { spawnKimi } from '../../kimi-cli.js';
import { spawnGemini } from '../../gemini-cli.js';
import { spawnGrok } from '../../grok-cli.js';
import { providerModelsService } from '../providers/index.js';
import { newRunId, recordAuditEvent, RunMeter } from '../governance/index.js';
import { normalizeProjectPath } from '../../shared/utils.js';
import { SUPPORTED_PROVIDERS } from '../../shared/providers.js';

export { SUPPORTED_PROVIDERS };

/**
 * Engine a background run uses when nobody picked one.
 *
 * Claude used to be this fallback. The Max subscription that backed it is gone,
 * so an omitted provider would start a run that dies on the first token.
 */
export const DEFAULT_UNATTENDED_PROVIDER = 'grok';

/**
 * Picks the engine for a run that has no human sitting on the composer.
 *
 * Order: the caller’s explicit provider → the user’s “open new chats on this
 * engine” setting → Grok. Exported for tests.
 *
 * @param {object} [options]
 * @param {string} [options.requestedProvider]
 * @param {string} [options.requestedModel]
 * @param {string} [options.requestedEffort]
 * @param {{ defaultProvider?: string|null, models?: Record<string,string>, efforts?: Record<string,string> }} [options.preferences]
 */
export function resolveRunEngine({
  requestedProvider,
  requestedModel,
  requestedEffort,
  preferences,
} = {}) {
  const prefs = preferences && typeof preferences === 'object'
    ? preferences
    : { models: {}, efforts: {}, defaultProvider: null };
  const explicit = typeof requestedProvider === 'string' && SUPPORTED_PROVIDERS.includes(requestedProvider)
    ? requestedProvider
    : null;
  const preferred = typeof prefs.defaultProvider === 'string' && SUPPORTED_PROVIDERS.includes(prefs.defaultProvider)
    ? prefs.defaultProvider
    : null;
  const provider = explicit || preferred || DEFAULT_UNATTENDED_PROVIDER;
  const models = prefs.models && typeof prefs.models === 'object' ? prefs.models : {};
  const efforts = prefs.efforts && typeof prefs.efforts === 'object' ? prefs.efforts : {};
  const model = (typeof requestedModel === 'string' && requestedModel) || models[provider] || undefined;
  const effort = (typeof requestedEffort === 'string' && requestedEffort) || efforts[provider] || undefined;
  return { provider, model, effort };
}

/**
 * Triggers allowed to identify themselves in the audit log. An unrecognised
 * value collapses to 'system' rather than being written through, so a typo
 * cannot silently create a new actor class nobody ever filters on.
 */
const KNOWN_ACTORS = new Set(['user', 'schedule', 'pipeline', 'telegram', 'api', 'git-helper', 'system']);

/**
 * Collects engine output instead of streaming it to an HTTP response.
 *
 * Engines talk to a "writer" with send()/end(); a background run has no socket
 * to write to, so this stands in for one and keeps the text.
 */
export class RunCollector {
  constructor(onEvent = null) {
    this.messages = [];
    this.sessionId = null;
    this.onEvent = onEvent;
  }

  send(data) {
    let parsed = data;
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = { type: 'raw', text: data };
      }
    }

    this.messages.push(parsed);

    if (parsed && parsed.sessionId) {
      this.sessionId = parsed.sessionId;
    }

    if (this.onEvent) {
      try {
        this.onEvent(parsed);
      } catch {
        // A misbehaving progress callback must not kill the run.
      }
    }
  }

  end() {
    // Nothing to close — there is no response stream.
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  getSessionId() {
    return this.sessionId;
  }

  /**
   * Assistant prose only, joined — what a human would call "the answer".
   *
   * Every engine emits the normalized envelope ({ kind, role, content }), so
   * this reads that and nothing else. Engines that only stream (kimi, gemini,
   * opencode) never send a final `text`, hence the delta fallback — but the
   * two are never mixed, or a streaming Claude run would count its answer twice.
   */
  getText() {
    const parts = [];
    const deltas = [];

    for (const message of this.messages) {
      if (!message || typeof message !== 'object') continue;
      if (typeof message.content !== 'string' || !message.content) continue;

      if (message.kind === 'text' && message.role !== 'user') {
        parts.push(message.content);
      } else if (message.kind === 'stream_delta') {
        deltas.push(message.content);
      }
    }

    if (parts.length > 0) {
      return parts.join('\n').trim();
    }
    return deltas.join('').trim();
  }
}

/**
 * Fail-closed project access, matching the rule the rest of the app follows:
 * admins see everything, everyone else sees only what was explicitly granted,
 * and an unknown project is a denial rather than a free pass.
 *
 * @returns {{ ok: true, projectPath: string } | { ok: false, error: string }}
 */
export function checkProjectAccess(userId, projectPath) {
  const normalized = normalizeProjectPath(String(projectPath || ''));
  if (!normalized) {
    return { ok: false, error: 'projectPath is required' };
  }

  const project = projectsDb.getProjectPath(normalized);
  if (!project) {
    return { ok: false, error: 'Project is not registered in this workspace' };
  }

  const user = userDb.getUserById(Number(userId));
  if (!user) {
    return { ok: false, error: 'Unknown user' };
  }

  if (user.role === 'admin') {
    return { ok: true, projectPath: normalized };
  }

  const accessible = userProjectAccessDb.getAccessibleProjectIds(user.id);
  if (!accessible.includes(project.project_id)) {
    return { ok: false, error: 'You do not have access to this project' };
  }

  return { ok: true, projectPath: normalized };
}

/**
 * Run one prompt to completion in a project and return what the agent said.
 *
 * @param {object} options
 * @param {string} options.projectPath   Absolute path of an already-registered project.
 * @param {string} options.prompt        What to ask.
 * @param {number} options.userId        Whose permissions this run borrows.
 * @param {string} [options.provider]    One of SUPPORTED_PROVIDERS. Omitted → user default engine, else Grok.
 * @param {string} [options.model]       Engine-specific model id.
 * @param {string} [options.effort]      Reasoning effort, where the engine supports it.
 * @param {string} [options.sessionId]   Resume an existing session instead of starting fresh.
 * @param {(event: object) => void} [options.onEvent]  Progress callback, best-effort.
 * @param {'schedule'|'pipeline'|'telegram'|'api'|'user'|'system'} [options.actor]
 *        What triggered this run, for the audit log. A schedule runs on behalf
 *        of a user but was not started by them; without this the feed cannot
 *        tell a nightly job from someone typing. Unset degrades to 'system'.
 * @returns {Promise<{ sessionId: string|null, text: string, messages: object[] }>}
 */
export async function runHeadlessPrompt(options) {
  const {
    projectPath,
    prompt,
    userId,
    provider: requestedProvider,
    model: requestedModel,
    effort: requestedEffort,
    sessionId = null,
    onEvent = null,
    actor,
  } = options || {};

  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmedPrompt) {
    throw new Error('prompt is required');
  }

  if (requestedProvider && !SUPPORTED_PROVIDERS.includes(requestedProvider)) {
    throw new Error(`provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }

  let preferences = { models: {}, efforts: {}, workMode: null, defaultProvider: null };
  try {
    preferences = providerPreferencesDb.getProviderPreferences(userId);
  } catch {
    // Callers without a DB (unit tests of neighbouring modules) still have to
    // resolve an engine; the Grok fallback covers them.
  }
  const { provider, model, effort } = resolveRunEngine({
    requestedProvider,
    requestedModel,
    requestedEffort,
    preferences,
  });

  const access = checkProjectAccess(userId, projectPath);
  if (!access.ok) {
    throw new Error(access.error);
  }

  // Who pressed the button. A schedule runs *on behalf of* a user but was not
  // started by them, and the audit feed is worthless if it cannot tell the two
  // apart. Defaults rather than throws: a missing actor should degrade the log,
  // never kill the run.
  const resolvedActor = KNOWN_ACTORS.has(actor) ? actor : 'system';
  if (!actor) {
    console.warn('runHeadlessPrompt called without an actor — audit will read "system"');
  }

  const cwd = access.projectPath;
  const collector = new RunCollector(onEvent);
  const base = { projectPath: cwd, cwd, sessionId: sessionId || null };

  const runId = newRunId();
  const meter = new RunMeter();
  const startedAt = Date.now();

  recordAuditEvent({
    actor: resolvedActor,
    event: 'run.start',
    userId,
    projectPath: cwd,
    sessionId: sessionId || null,
    runId,
    provider,
    model: model ?? null,
    detail: trimmedPrompt,
  });

  let outcome = 'ok';
  let failureDetail = null;

  try {
    if (provider === 'claude') {
      await queryClaudeSDK(trimmedPrompt, { ...base, model, effort, permissionMode: 'bypassPermissions', meter }, collector);
    } else if (provider === 'cursor') {
      await spawnCursor(trimmedPrompt, { ...base, model: model || undefined, skipPermissions: true }, collector);
    } else if (provider === 'codex') {
      const models = (await providerModelsService.getProviderModels('codex')).models;
      await spawnCodexCompat(trimmedPrompt, { ...base, model: model || models.DEFAULT, effort, permissionMode: 'bypassPermissions' }, collector);
    } else if (provider === 'opencode') {
      const models = (await providerModelsService.getProviderModels('opencode')).models;
      await spawnOpenCode(trimmedPrompt, { ...base, model: model || models.DEFAULT, effort, permissionMode: 'bypassPermissions' }, collector);
    } else if (provider === 'kimi') {
      const models = (await providerModelsService.getProviderModels('kimi')).models;
      // Headless kimi -p is always fully autonomous — it has no permissionMode to map.
      await spawnKimi(trimmedPrompt, { ...base, model: model || models.DEFAULT }, collector);
    } else if (provider === 'gemini') {
      const models = (await providerModelsService.getProviderModels('gemini')).models;
      await spawnGemini(trimmedPrompt, { ...base, model: model || models.DEFAULT, permissionMode: 'bypassPermissions' }, collector);
    } else if (provider === 'grok') {
      const models = (await providerModelsService.getProviderModels('grok')).models;
      await spawnGrok(trimmedPrompt, { ...base, model: model || models.DEFAULT, effort, permissionMode: 'bypassPermissions', meter }, collector);
    }
  } catch (err) {
    outcome = 'error';
    failureDetail = err?.message ?? String(err);
    throw err;
  } finally {
    const cost = meter.finish();
    recordAuditEvent({
      actor: resolvedActor,
      event: outcome === 'error' ? 'run.error' : 'run.finish',
      userId,
      projectPath: cwd,
      sessionId: collector.getSessionId() || sessionId || null,
      runId,
      provider,
      model: cost.model ?? model ?? null,
      outcome,
      detail: failureDetail,
      tokensIn: cost.breakdown.inputTokens,
      tokensOut: cost.breakdown.outputTokens,
      cacheRead: cost.breakdown.cacheReadTokens,
      cacheWrite5m: cost.breakdown.cacheWrite5mTokens,
      cacheWrite1h: cost.breakdown.cacheWrite1hTokens,
      costMicroUsd: cost.costMicroUsd,
      durationMs: Date.now() - startedAt,
    });
  }

  return {
    sessionId: collector.getSessionId(),
    text: collector.getText(),
    messages: collector.messages,
  };
}

// queryCodex keeps the same (prompt, options, writer) contract as the others;
// aliasing it here keeps the dispatch above uniform.
function spawnCodexCompat(prompt, options, writer) {
  return queryCodex(prompt, options, writer);
}

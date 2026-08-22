// One place that answers "run this prompt in this project, nobody is watching".
//
// Pipelines, schedules and the Telegram bot all need exactly that, and all three
// would otherwise grow their own copy of the provider dispatch in routes/agent.js.
// The dispatch itself is deliberately identical to that route — same engines,
// same bypassPermissions posture — because an unattended run has no human to
// answer a permission prompt.

import { projectsDb, userDb, userProjectAccessDb } from '../database/index.js';
import { queryClaudeSDK } from '../../claude-sdk.js';
import { spawnCursor } from '../../cursor-cli.js';
import { queryCodex } from '../../openai-codex.js';
import { spawnOpenCode } from '../../opencode-cli.js';
import { spawnKimi } from '../../kimi-cli.js';
import { spawnGemini } from '../../gemini-cli.js';
import { spawnGrok } from '../../grok-cli.js';
import { providerModelsService } from '../providers/index.js';
import { normalizeProjectPath } from '../../shared/utils.js';
import { SUPPORTED_PROVIDERS } from '../../shared/providers.js';

export { SUPPORTED_PROVIDERS };

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
 * @param {string} [options.provider]    One of SUPPORTED_PROVIDERS. Defaults to claude.
 * @param {string} [options.model]       Engine-specific model id.
 * @param {string} [options.effort]      Reasoning effort, where the engine supports it.
 * @param {string} [options.sessionId]   Resume an existing session instead of starting fresh.
 * @param {(event: object) => void} [options.onEvent]  Progress callback, best-effort.
 * @returns {Promise<{ sessionId: string|null, text: string, messages: object[] }>}
 */
export async function runHeadlessPrompt(options) {
  const {
    projectPath,
    prompt,
    userId,
    provider = 'claude',
    model,
    effort,
    sessionId = null,
    onEvent = null,
  } = options || {};

  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmedPrompt) {
    throw new Error('prompt is required');
  }

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }

  const access = checkProjectAccess(userId, projectPath);
  if (!access.ok) {
    throw new Error(access.error);
  }

  const cwd = access.projectPath;
  const collector = new RunCollector(onEvent);
  const base = { projectPath: cwd, cwd, sessionId: sessionId || null };

  if (provider === 'claude') {
    await queryClaudeSDK(trimmedPrompt, { ...base, model, effort, permissionMode: 'bypassPermissions' }, collector);
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
    await spawnGrok(trimmedPrompt, { ...base, model: model || models.DEFAULT, permissionMode: 'bypassPermissions' }, collector);
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

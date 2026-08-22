/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { buildClaudeUserContent, normalizeImageDescriptors } from './shared/image-attachments.js';
import { CLAUDE_FALLBACK_MODELS } from './modules/providers/list/claude/claude-models.provider.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { resolveClaudeCodeExecutablePath } from './shared/claude-cli-path.js';
import { workModeInstruction } from './shared/work-mode.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { createCompleteMessage, createNormalizedMessage } from './shared/utils.js';
import { recordRunOutcome, buildRunInterruptedNotice, isTransientRunFailure } from './shared/run-outcomes.js';
import { checkUsageGuard, buildUsageGuardNotice } from './shared/claude-usage.js';
import { getContextWindow } from './shared/token-pricing.js';

// The CLI binary self-updates by swapping a versions/X.Y.Z file and
// repointing the ~/.local/bin/claude symlink (see resolveClaudeCodeExecutablePath).
// If a run spawns in the split second the swap is in flight, the SDK's
// existsSync() check passes but the actual execve() fails, surfacing as
// "Claude Code native binary at <path> exists but failed to launch." This is
// a transient TOCTOU race, not a real install problem, so retry once before
// giving up — but only when nothing has streamed yet (safe to redo from
// scratch without risking duplicated output).
const CLI_SPAWN_RACE_PATTERN = /exists but failed to launch/i;
const CLI_SPAWN_RACE_RETRY_DELAY_MS = 800;

// A run can still die on Anthropic being overloaded or dropping the connection
// even with the CLI's own retry watchdog on (see mapCliOptionsToSDK). The user's
// only recourse used to be re-sending the message by hand — often losing an
// hour of agent work to a red error banner. The run loop now does that resend
// itself, on the same session, waiting longer after each failure. Four attempts
// span ~3.5 minutes, which covers a typical 529 wave.
const TRANSIENT_RETRY_DELAYS_MS = [5_000, 20_000, 60_000, 120_000];

// Stop must mean stop. `interrupt()` is only a request: it travels over the
// SDK control channel and the CLI honours it when it gets to it — a model
// mid-block, a wedged tool call or a dead control channel all leave the run
// happily going while the user is looking at a stopped chat. So the abort path
// is staged: interrupt (clean, keeps the transcript resumable), then close
// stdin, then tear the process down by force if the run is still alive.
const ABORT_INTERRUPT_TIMEOUT_MS = 3_000;
const ABORT_HARD_KILL_DELAY_MS = 2_500;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const activeSessions = new Map();
const pendingToolApprovals = new Map();
// Sessions cancelled via abort-session. The abort handler already sent the
// terminal `complete` (aborted: true) to the client, so the run loop must not
// emit a second one when its generator winds down.
const abortedSessionIds = new Set();

// 5 minutes: the web client is often a phone that is not being watched the
// moment a tool asks for permission — 55s meant requests silently expired
// (denied) before the user ever saw the banner or the push notification.
const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 300000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

const isExitPlanModeTool = (toolName) => toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode';

// The Claude Code CLI (>=2.1.x) already defers MCP tools behind a ToolSearch
// tool by default: telegram/playwright/windows/ollama schemas (~30k tokens,
// telegram alone is 101 tools) are pulled in on demand instead of bloating the
// turn-1 prompt. We only need to opt specific servers OUT of that deferral.
// MCP servers whose tools must stay in the prompt (alwaysLoad, never deferred)
// because the model needs them on essentially every turn — obsidian-dimasik is
// the external memory. Verified against claude 2.1.218 (see .tmp verify runs):
// without this the memory tools are deferred and invisible at turn 1.
const MCP_ALWAYS_LOAD_SERVERS = new Set(['obsidian-dimasik']);

// Nudge for weaker (Kimi) models. The Claude Code CLI defers heavy MCP servers
// behind a ToolSearch tool: only the server name reaches the turn-1 prompt, not
// the ~30k tokens of tool schemas (telegram alone is 101 tools). Claude loads
// them on demand automatically; Kimi tends to see just the name and declare the
// tool unusable ("I see telegram but can't call it") instead of searching. This
// ~40-token hint restores access without pinning every schema into every turn
// (~750x cheaper than alwaysLoad). Scoped to Kimi — Claude needs no reminder.
const MCP_DEFERRED_TOOLS_HINT =
  'Some MCP server tools (e.g. telegram, windows, playwright, ollama) are loaded ' +
  'on demand: only the server name is visible to you, not the individual tool ' +
  'schemas. Before calling any such MCP tool, first call the ToolSearch tool ' +
  '(e.g. query "select:mcp__telegram__get_messages", or keywords like "telegram ' +
  'messages") to load its schema, then call the tool. Never tell the user an MCP ' +
  'tool is unavailable without calling ToolSearch for it first.';

// UI model ids that route to Kimi's endpoint (consumed in mapCliOptionsToSDK).
// Module-scoped so the MCP-pin logic in queryClaudeSDK can detect Kimi too.
const KIMI_MODEL_MAP = {
  'kimi-k3': 'k3',
  'kimi-coding': 'kimi-for-coding',
  'kimi-coding-highspeed': 'kimi-for-coding-highspeed',
};
const isKimiModel = (model) =>
  typeof model === 'string' && Object.prototype.hasOwnProperty.call(KIMI_MODEL_MAP, model);

// UI model ids that route to Ollama on the Windows box (RTX 5070), reached over
// the persistent launchd SSH tunnel com.dimasik.ollama-tunnel (11435 -> 11434).
// Ollama serves the native Anthropic Messages API since 0.14, so the SAME Claude
// Code engine runs against it with no proxy or shim — only the base URL and the
// model id change. Free, and it does not touch the Claude Max limit.
const LOCAL_MODEL_MAP = {
  'local-ornith-9b': 'ornith-agent',
  'local-qwen35-9b': 'qwen35-agent',
};

// UI model ids that route to a third-party provider over its OFFICIAL
// Anthropic-compatible endpoint — same shape as the Kimi and Ollama branches
// below, so the same Claude Code engine runs unchanged and skills, hooks,
// subagents, MCP and memory keep working (those are client features, not model
// ones). Each provider bills a FLAT subscription, not per token: at our volume
// (~6B cached-read tokens/month) per-token pricing costs multiples of the
// Claude Max plan, so pay-per-token backends deliberately do not belong here.
// These exist to keep working when the Claude 5-hour window runs out, not to
// save money. `keyEnv` names the env var holding that provider's key.
const BYO_MODEL_MAP = {
  // The only provider that officially accepts IMAGES through its
  // Anthropic-compatible endpoint — the others either reject them or silently
  // route them to a non-vision model. That is why it is here.
  'minimax-m3': {
    model: 'MiniMax-M3[1m]',
    baseUrl: 'https://api.minimax.io/anthropic',
    keyEnv: 'MINIMAX_API_KEY',
  },
  // The only provider that contractually promises not to train on API data,
  // so this is the one to use on client work. Z.ai routes by Anthropic alias
  // rather than by model id, hence the ANTHROPIC_DEFAULT_*_MODEL trio.
  'glm-5-2': {
    model: 'GLM-5.2',
    baseUrl: 'https://api.z.ai/api/anthropic',
    keyEnv: 'ZAI_API_KEY',
    smallModel: 'GLM-4.7',
    extraEnv: {
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'GLM-5.2',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'GLM-5.2',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'GLM-4.7',
    },
  },
};

// Anthropic-style effort levels that a given Kimi model actually understands
// when translated to Kimi's native vocabulary (low/high/max). The SDK only
// accepts Anthropic levels; we translate right before the request goes out.
// K2.7 models expose no effort control at all — they always think at their
// one fixed level, so they are absent here and will have effort stripped.
const KIMI_EFFORT_MAP = {
  k3: { low: 'low', high: 'high', max: 'max' },
};

// Plan B for Kimi's weak tool discovery. The ~40-token ToolSearch hint above is
// not enough: Kimi ignores ToolSearch and, rather than call the deferred
// telegram MCP, reverse-engineers telegram-mcp and hits the API with raw creds.
// So when a Kimi chat actually works with a given MCP server, pin that server —
// its tools then sit directly in the prompt and Kimi can call them with no
// ToolSearch. Kept OFF by default so ordinary turns never pay the schema cost
// (telegram alone is ~30k); sticky per session so follow-ups in the SAME chat
// stay pinned. Claude is untouched (it uses ToolSearch fine). Applies to all
// heavy local MCPs: telegram, windows, playwright, ollama.
const KIMI_MCP_PIN_RULES = [
  { server: 'telegram', re: /telegram|телеграм|избранн|(?:^|[^a-zа-яё])(?:тг|tg)(?:[^a-zа-яё]|$)/i },
  { server: 'windows', re: /windows|виндов|винсервер|винд[аеы]/i },
  { server: 'playwright', re: /playwright|плейрайт|плейврайт|браузер|browser/i },
  { server: 'ollama', re: /ollama|оллама|олама|qwen|квен|gemma|гемма/i },
];
// sessionId -> Set of pinned server names (sticky per chat).
const KIMI_PINNED_MCP_BY_SESSION = new Map();

// Safety net for the held-open prompt stream (see buildPromptPayload): if the
// CLI never emits `session_state_changed: idle` — version drift, or the event
// simply not firing for a turn shape — the input stays open and the run hangs
// forever with no terminal `complete`. After a completed turn, prolonged
// total silence (with no permission prompt waiting on the user) means the
// idle event is not coming. Short threshold when the CLI has emitted no
// session-state events at all (it never will); long one otherwise, because
// background agents may legitimately stay quiet before their turn flushes.
const IDLE_FALLBACK_NO_STATE_EVENTS_MS = parseInt(process.env.CLAUDE_IDLE_FALLBACK_NO_STATE_EVENTS_MS, 10) || 60_000;
const IDLE_FALLBACK_SILENCE_MS = parseInt(process.env.CLAUDE_IDLE_FALLBACK_SILENCE_MS, 10) || 30 * 60_000;
const IDLE_FALLBACK_CHECK_INTERVAL_MS = 10_000;
// Grace window before honoring an `idle` event with no pending approvals.
// The CLI can emit `session_state_changed: idle` a beat BEFORE the matching
// permission control-request reaches canUseTool — the pending-approvals guard
// then sees an empty map and releasing on the spot closes the CLI's stdin
// right before AskUserQuestion/ExitPlanMode needs it ("Tool permission
// request failed: AbortError: Stream closed" even with the guard deployed).
// Defer the release and re-check at fire time; by then the control request
// has landed and the guard sees the real state.
const RELEASE_GRACE_MS = parseInt(process.env.CLAUDE_RELEASE_GRACE_MS, 10) || 3_000;

function resolveClaudeEffort(model, effort, modelsDefinition = CLAUDE_FALLBACK_MODELS) {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model) || null;
  const allowedEfforts = selectedModel?.effort?.values
    ?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function waitForToolApproval(requestId, options = {}) {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel, metadata } = options;

  return new Promise(resolve => {
    let settled = false;

    const finalize = (decision) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    let timeout;

    const cleanup = () => {
      pendingToolApprovals.delete(requestId);
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    // timeoutMs 0 = wait indefinitely (interactive tools)
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        onCancel?.('timeout');
        finalize(null);
      }, timeoutMs);
    }

    const abortHandler = () => {
      onCancel?.('cancelled');
      finalize({ cancelled: true });
    };

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resolver = (decision) => {
      finalize(decision);
    };
    // Attach metadata for getPendingApprovalsForSession lookup
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingToolApprovals.set(requestId, resolver);
  });
}

function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

// Match stored permission entries against a tool + input combo.
// This only supports exact tool names and the Bash(command:*) shorthand
// used by the UI; it intentionally does not implement full glob semantics,
// introduced to stay consistent with the UI's "Allow rule" format.
function matchesToolPermission(entry, toolName, input) {
  if (!entry || !toolName) {
    return false;
  }

  if (entry === toolName) {
    return true;
  }

  const bashMatch = entry.match(/^Bash\((.+):\*\)$/);
  if (toolName === 'Bash' && bashMatch) {
    const allowedPrefix = bashMatch[1];
    let command = '';

    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof input.command === 'string') {
      command = input.command.trim();
    }

    if (!command) {
      return false;
    }

    return command.startsWith(allowedPrefix);
  }

  return false;
}

function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode, effort } = options;

  const sdkOptions = {};

  // Forward all host env vars (e.g. ANTHROPIC_BASE_URL) to the subprocess.
  // Since SDK 0.2.113, options.env replaces process.env instead of overlaying it.
  // CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS makes the CLI emit
  // `session_state_changed` messages; queryClaudeSDK relies on the `idle`
  // one to release the held-open prompt stream so the CLI can exit.
  // CLAUDE_CODE_RETRY_WATCHDOG makes the CLI survive Anthropic being overloaded
  // instead of failing the run with "API Error: 529 Overloaded". Without it the
  // CLI (a) caps retries at 10, (b) gives up when the server asks to wait too
  // long, and (c) drops a 529 outright in background sub-requests (compaction,
  // subagents) — its own telemetry calls that `overload_background_dropped`.
  // With it: 300 retries, mid-stream 529s retried, long waits honoured.
  sdkOptions.env = {
    ...process.env,
    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
    CLAUDE_CODE_RETRY_WATCHDOG: process.env.CLAUDE_CODE_RETRY_WATCHDOG || '1',
  };

  // Resolve the executable eagerly on Windows because the SDK uses raw child_process.spawn,
  // which does not reliably follow npm's shell wrappers like cross-spawn does.
  sdkOptions.pathToClaudeCodeExecutable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // NOTE: `settings.skipPermissions` deliberately does NOT override
  // permissionMode here any more. It now decides which mode a chat STARTS in
  // (see getDefaultPermissionModeForProvider in useChatProviderState.ts), so
  // the mode the client sends is always the mode that runs. Overriding it
  // here made the composer's mode chip lie: a user who switched a chat back
  // to "default" to be asked again still got a silent full-access run.

  let allowedTools = [...(settings.allowedTools || [])];

  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  sdkOptions.model = options.model || CLAUDE_FALLBACK_MODELS.DEFAULT;

  const resolvedEffort = resolveClaudeEffort(
    sdkOptions.model,
    effort,
    options.effortModels || CLAUDE_FALLBACK_MODELS,
  );
  if (resolvedEffort) {
    sdkOptions.effort = resolvedEffort;
  }

  // Kimi models: the UI ids in this map run the same Claude Code engine
  // pointed at Kimi's Anthropic-compatible endpoint using a separate Kimi
  // subscription — they do NOT touch the Claude Max limit. Each UI id maps to
  // Kimi's native model id, and the base URL + key are injected into THIS
  // subprocess env only. Non-Kimi models fall through untouched (Claude Max).
  const kimiModel = typeof sdkOptions.model === 'string' ? KIMI_MODEL_MAP[sdkOptions.model] : undefined;
  if (kimiModel) {
    const kimiKey = (process.env.KIMI_CODE_KEY || '').trim();
    sdkOptions.model = kimiModel;
    sdkOptions.env = {
      ...sdkOptions.env,
      ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
      ANTHROPIC_API_KEY: kimiKey,
      ANTHROPIC_AUTH_TOKEN: kimiKey,
      ANTHROPIC_MODEL: kimiModel,
      ANTHROPIC_SMALL_FAST_MODEL: 'kimi-for-coding',
    };
    // Kimi's gateway accepts its own effort vocabulary (low/high/max), not
    // Anthropic's (low/medium/high/xhigh/max). The resolveClaudeEffort call
    // above already vetted `effort` against the model's declared UI values;
    // here we translate to the native level. Anything not in KIMI_EFFORT_MAP
    // (i.e. the K2.7 models, which have no effort control) is stripped, so
    // the gateway never receives a level it can't parse.
    const translatedEffort = KIMI_EFFORT_MAP[kimiModel]?.[sdkOptions.effort];
    if (translatedEffort) {
      sdkOptions.effort = translatedEffort;
    } else {
      delete sdkOptions.effort;
    }
  }

  // Local models: same shape as the Kimi branch above, pointed at Ollama's
  // Anthropic-compatible endpoint instead. The tunnel host is overridable so a
  // client install can point at its own box (or at Ollama running locally).
  // The mapped ids are derived models carrying num_ctx 64k — stock Ollama tags
  // default to 4096, which cannot even hold the Claude Code system prompt.
  const localModel = typeof sdkOptions.model === 'string' ? LOCAL_MODEL_MAP[sdkOptions.model] : undefined;
  if (localModel) {
    sdkOptions.model = localModel;
    sdkOptions.env = {
      ...sdkOptions.env,
      ANTHROPIC_BASE_URL: process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435',
      ANTHROPIC_API_KEY: 'ollama',
      ANTHROPIC_AUTH_TOKEN: 'ollama',
      ANTHROPIC_MODEL: localModel,
      ANTHROPIC_SMALL_FAST_MODEL: process.env.LOCAL_LLM_SMALL_MODEL || localModel,
      // Claude Code does not recognise these model ids. Its unknown-model window
      // enforcement then refuses the turn outright ("Prompt is too long") and
      // its auto-compaction fails on top of that, so nothing is ever sent. The
      // backend already knows its own window, so let it decide: measured 20.08,
      // Ollama accepts 33k+ happily and the same turn that failed came back in
      // 22 s. Setting CLAUDE_CODE_MAX_CONTEXT_TOKENS instead does NOT help —
      // enforcement still fires.
      CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
      // num_ctx must hold prompt AND answer; an unbounded ask overflows it.
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.LOCAL_LLM_MAX_OUTPUT_TOKENS || '16384',
    };
    // Ollama exposes no effort control, and an unknown level is a hard error.
    delete sdkOptions.effort;
  }

  // Third-party subscriptions (see BYO_MODEL_MAP): same injection as the two
  // branches above, keyed per provider. Runs on that provider's own plan, so
  // it does NOT consume the Claude Max limit.
  const byoModel = typeof sdkOptions.model === 'string' ? BYO_MODEL_MAP[sdkOptions.model] : undefined;
  if (byoModel) {
    const byoKey = (process.env[byoModel.keyEnv] || '').trim();
    sdkOptions.model = byoModel.model;
    sdkOptions.env = {
      ...sdkOptions.env,
      ANTHROPIC_BASE_URL: byoModel.baseUrl,
      ANTHROPIC_API_KEY: byoKey,
      ANTHROPIC_AUTH_TOKEN: byoKey,
      ANTHROPIC_MODEL: byoModel.model,
      ANTHROPIC_SMALL_FAST_MODEL: byoModel.smallModel || byoModel.model,
      ...(byoModel.extraEnv || {}),
    };
    // Neither gateway understands Anthropic's effort vocabulary, and an
    // unknown level is a hard error — same reasoning as the Ollama branch.
    delete sdkOptions.effort;
  }

  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'
  };

  // Kimi is weaker at agentic tool discovery and does not reliably call
  // ToolSearch for deferred MCP servers, so telegram/windows/etc. look present
  // but uncallable. Append a short hint for Kimi only (Claude does this
  // unprompted). Far cheaper than un-deferring the schemas via alwaysLoad.
  const appendedSystemPrompt = [];
  if (kimiModel) {
    appendedSystemPrompt.push(MCP_DEFERRED_TOOLS_HINT);
  }

  // How chatty the run is with the user (composer's work-mode chip). Appended
  // to the system prompt rather than to the message so it never shows up in
  // the chat history the user reads back. Autopilot appends nothing.
  const workModeText = workModeInstruction(options.workMode, permissionMode);
  if (workModeText) {
    appendedSystemPrompt.push(workModeText);
  }

  if (appendedSystemPrompt.length > 0) {
    sdkOptions.systemPrompt.append = appendedSystemPrompt.join('\n\n');
  }

  sdkOptions.settingSources = ['project', 'user', 'local'];

  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Object} writer - WebSocket writer for reconnect support
 * @param {Object} controls - Run-scoped kill switches used by the abort path:
 *   `releaseInput` closes the held-open stdin so an interrupted CLI can exit,
 *   `abortController` tears the CLI process down when the interrupt is
 *   ignored, and `runState.finished` tells those two cases apart.
 */
function addSession(sessionId, queryInstance, writer = null, controls = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    writer,
    releaseInput: controls?.releaseInput ?? null,
    abortController: controls?.abortController ?? null,
    runState: controls?.runState ?? null
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

function readNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Context window for the composer badge's denominator. The window belongs to
 * the model (1M on current Opus/Sonnet), so a global constant misreported it;
 * an explicit CONTEXT_WINDOW override still wins for custom setups.
 * @param {string|null|undefined} model
 * @returns {number}
 */
function resolveContextWindow(model) {
  const override = parseInt(process.env.CONTEXT_WINDOW, 10);
  return Number.isFinite(override) ? override : getContextWindow(model);
}

/**
 * Extracts token usage from SDK messages.
 * Prefers per-step `message.usage` (Claude message payload), then falls back
 * to result-level usage/modelUsage for compatibility across SDK versions.
 * @param {Object} sdkMessage - SDK stream message
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudget(sdkMessage) {
  if (!sdkMessage || typeof sdkMessage !== 'object') {
    return null;
  }

  const messageUsage = sdkMessage.message?.usage || sdkMessage.usage;
  if (messageUsage && typeof messageUsage === 'object') {
    const directInputTokens = readNumber(messageUsage.input_tokens ?? messageUsage.inputTokens);
    const cacheCreationTokens = readNumber(messageUsage.cache_creation_input_tokens ?? messageUsage.cacheCreationInputTokens ?? messageUsage.cacheCreationTokens);
    const cacheReadTokens = readNumber(messageUsage.cache_read_input_tokens ?? messageUsage.cacheReadInputTokens ?? messageUsage.cacheReadTokens);
    const cacheTokens = cacheCreationTokens + cacheReadTokens;
    const inputTokens = directInputTokens + cacheTokens;
    const outputTokens = readNumber(messageUsage.output_tokens ?? messageUsage.outputTokens);
    const totalUsed = inputTokens + outputTokens;
    const model = typeof sdkMessage.message?.model === 'string' ? sdkMessage.message.model : null;
    const contextWindow = resolveContextWindow(model);

    return {
      used: totalUsed,
      total: contextWindow,
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      cacheTokens,
      breakdown: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  }

  if (!sdkMessage.modelUsage || typeof sdkMessage.modelUsage !== 'object') {
    return null;
  }

  // Fallback for older SDK messages with only modelUsage
  const modelKey = Object.keys(sdkMessage.modelUsage)[0];
  const modelData = sdkMessage.modelUsage[modelKey];

  if (!modelData || typeof modelData !== 'object') {
    return null;
  }

  const inputTokens = readNumber(modelData.cumulativeInputTokens ?? modelData.inputTokens);
  const outputTokens = readNumber(modelData.cumulativeOutputTokens ?? modelData.outputTokens);
  const totalUsed = inputTokens + outputTokens;
  const contextWindow = resolveContextWindow(modelKey);

  return {
    used: totalUsed,
    total: contextWindow,
    model: modelKey ?? null,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

/**
 * Builds the SDK `prompt` payload for one turn.
 *
 * Always uses the SDK's streaming-input mode: a single SDKUserMessage (text,
 * plus one base64 `image` block per attachment from `~/.cloudcli/assets`),
 * after which the generator stays pending on `holdInputOpen`. With a one-shot
 * prompt the SDK closes the CLI's stdin at the first `result`, but background
 * tasks can queue follow-up turns in the same process — interactive tools
 * (AskUserQuestion, ExitPlanMode) called there then fail instantly with
 * "Tool permission request failed: Error: Stream closed" because the control
 * channel is gone. Holding the generator open keeps stdin alive for the whole
 * run; the caller resolves `holdInputOpen` when the CLI reports
 * `session_state_changed: idle` (or the run errors/aborts).
 *
 * @param {string} command - User prompt
 * @param {Array} images - Image descriptors ({ path, name?, mimeType? })
 * @param {string} cwd - Project working directory image paths resolve against
 * @param {Promise<void>} holdInputOpen - Resolved by the caller after the run
 * @returns {Promise<AsyncIterable>} SDK prompt payload
 */
async function buildPromptPayload(command, images, cwd, holdInputOpen) {
  const content = normalizeImageDescriptors(images).length === 0
    ? [{ type: 'text', text: command }]
    : await buildClaudeUserContent(command, images, cwd);
  return (async function* () {
    yield {
      type: 'user',
      message: {
        role: 'user',
        content
      },
      parent_tool_use_id: null,
      timestamp: new Date().toISOString()
    };
    await holdInputOpen;
  })();
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      // No config file
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      // Global MCP servers loaded
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        // Project MCP servers merged
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      return null;
    }
    return mcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId, sessionSummary } = options;
  let capturedSessionId = sessionId;
  // Servers this run pins for Kimi (see mcpServers build), so the session id
  // captured mid-run can be added to the sticky map for a brand-new chat.
  const pinnedMcpThisRun = new Set();
  let sessionCreatedSent = false;

  // Usage guard: hold new runs once the 5-hour subscription window crosses the
  // threshold, keeping a reserve for the owner's interactive questions. The
  // composer resends with usageGuardOverride after an explicit confirmation.
  // Fails open — unknown usage never blocks a run.
  if (options.usageGuardOverride !== true) {
    try {
      const guard = await checkUsageGuard();
      if (guard.blocked) {
        ws.send(createNormalizedMessage({ kind: 'error', content: buildUsageGuardNotice(guard), sessionId: sessionId || null, provider: 'claude' }));
        ws.send(createCompleteMessage({ provider: 'claude', sessionId: sessionId || null, exitCode: 1 }));
        return;
      }
    } catch (guardError) {
      console.warn('[Claude SDK] Usage guard check failed, letting the run through:', guardError);
    }
  }

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  // Resolved when the run ends (success, error or abort) so the streaming
  // prompt generator holding the CLI's stdin open can finish and let the
  // SDK shut the transport down cleanly.
  let inputReleased = false;
  let releaseInput = () => {};
  const holdInputOpen = new Promise(resolve => {
    releaseInput = () => { inputReleased = true; resolve(); };
  });
  let idleFallbackTimer = null;

  // Kill switches handed to the abort path via the active-sessions map, so
  // "Stop" can go all the way down to the CLI process instead of only asking
  // it nicely. `finished` flips in the finally below and is what stops the
  // hard kill from firing at a run that already ended on its own.
  const runAbortController = new AbortController();
  const runState = { finished: false };
  const runControls = {
    releaseInput: () => releaseInput(),
    abortController: runAbortController,
    runState
  };

  try {
    const resolvedModel = await providerModelsService.resolveResumeModel(
      'claude',
      sessionId,
      options.model,
    );
    const resolvedEffort = await providerModelsService.resolveResumeEffort(
      'claude',
      sessionId,
      options.effort,
    );
    let effortModels = CLAUDE_FALLBACK_MODELS;
    try {
      effortModels = (await providerModelsService.getProviderModels('claude')).models;
    } catch (error) {
      console.warn('[Claude SDK] Unable to load provider models for effort validation:', error);
    }

    const sdkOptions = mapCliOptionsToSDK({
      ...options,
      model: resolvedModel || options.model,
      effort: resolvedEffort || options.effort,
      effortModels,
    });

    // The SDK's own cancellation handle: aborting it closes stdin, gives the
    // CLI a short grace window, then kills the process. Only used as the last
    // stage of the abort path (see abortClaudeSDKSession).
    sdkOptions.abortController = runAbortController;

    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      // Pin the memory server so its tools stay in the prompt instead of being
      // deferred behind ToolSearch with the rest. Applied for every provider:
      // on Claude it un-defers memory; on Kimi it is a harmless no-op if the
      // gateway ignores alwaysLoad, and keeps memory reachable if it doesn't.
      const alwaysLoad = new Set(MCP_ALWAYS_LOAD_SERVERS);

      // Kimi sessions: pin an MCP server whose domain shows up in the message
      // (Kimi ignores ToolSearch, so deferred tools are unusable for it).
      // Sticky for the rest of that chat. See KIMI_MCP_PIN_RULES /
      // KIMI_PINNED_MCP_BY_SESSION.
      if (isKimiModel(resolvedModel || options.model)) {
        const sid = capturedSessionId || sessionId || null;
        const sticky = sid ? KIMI_PINNED_MCP_BY_SESSION.get(sid) : undefined;
        const text = command || '';
        for (const { server, re } of KIMI_MCP_PIN_RULES) {
          if (!mcpServers[server]) continue; // not configured — nothing to pin
          if (re.test(text) || (sticky && sticky.has(server))) {
            alwaysLoad.add(server);
            pinnedMcpThisRun.add(server);
            if (sid) {
              let set = KIMI_PINNED_MCP_BY_SESSION.get(sid);
              if (!set) KIMI_PINNED_MCP_BY_SESSION.set(sid, (set = new Set()));
              set.add(server);
            }
          }
        }
      }

      for (const [name, config] of Object.entries(mcpServers)) {
        if (config && typeof config === 'object' && alwaysLoad.has(name)) {
          mcpServers[name] = { ...config, alwaysLoad: true };
        }
      }
      sdkOptions.mcpServers = mcpServers;
    }

    // Streaming input keeps the SDK↔CLI control channel open for the whole
    // run (see buildPromptPayload). Built per query attempt because an async
    // generator cannot be replayed once consumed.
    const createPrompt = () => buildPromptPayload(command, options.images, options.cwd, holdInputOpen);

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input) => {
          const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
          emitNotification(createNotificationEvent({
            provider: 'claude',
            sessionId: capturedSessionId || sessionId || null,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${capturedSessionId || sessionId || 'none'}:${message}`
          }));
          return {};
        }]
      }]
    };

    // Caveat: in 'auto' and 'bypassPermissions' modes the SDK resolves approval
    // at the permission-mode step and skips this callback, so interactive tools
    // (AskUserQuestion, ExitPlanMode) won't reach the UI — the classifier/bypass
    // auto-approves them and the model acts on a generated answer. Move these
    // tools to a PreToolUse hook (runs before the mode check) if we need them
    // to work in those modes.
    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions') {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      emitNotification(createNotificationEvent({
        provider: 'claude',
        sessionId: capturedSessionId || sessionId || null,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName, sessionName: sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `claude:permission:${capturedSessionId || sessionId || 'none'}:${requestId}`
      }));

      const decision = await waitForToolApproval(requestId, {
        // Wait indefinitely for every permission prompt, not just interactive
        // tools. The idle-fallback loop below already treats a pending approval
        // as activity ("the user may take hours"), so a 5-min auto-deny here
        // silently rejected commands the user never got to see. 0 = wait forever.
        timeoutMs: 0,
        signal: context?.signal,
        metadata: {
          _sessionId: capturedSessionId || sessionId || null,
          _toolName: toolName,
          _input: input,
          _receivedAt: new Date(),
        },
        onCancel: (reason) => {
          ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        // Approving the plan must also drop the read-only mode for the rest of
        // this run — otherwise the CLI keeps refusing every edit the plan it
        // just got approved asks for. It goes to `bypassPermissions`, not
        // `default`: approving the plan is the consent, and stopping to ask on
        // every step of an approved plan defeats the point of writing one.
        // The UI mirrors this on its own mode chip (see ChatInterface).
        if (isExitPlanModeTool(toolName)) {
          // Mirror it on our own copy too: `sdkOptions` is per-run, and this is
          // what the fast path above reads. Without it the callback would keep
          // asking for the rest of the run if the CLI still routes through it.
          sdkOptions.permissionMode = 'bypassPermissions';
          return {
            behavior: 'allow',
            updatedInput: decision.updatedInput ?? input,
            updatedPermissions: [{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }],
          };
        }

        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    let queryInstance;
    let anyMessageReceived = false;
    let spawnRaceAttempt = 0;
    let transientRetryAttempt = 0;

    while (true) {
      try {
        try {
          queryInstance = query({
            prompt: await createPrompt(),
            options: sdkOptions
          });
        } catch (hookError) {
          // Older/newer SDK versions may not accept hook shapes yet.
          // Keep notification behavior operational via runtime events even if hook registration fails.
          console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', hookError?.message || hookError);
          delete sdkOptions.hooks;
          queryInstance = query({
            prompt: await createPrompt(),
            options: sdkOptions
          });
        }

        // Track the query instance for abort capability
        if (capturedSessionId) {
          addSession(capturedSessionId, queryInstance, ws, runControls);
        }

        // Safety net: if `session_state_changed: idle` never arrives, the
        // held-open input would keep this loop (and the run) alive forever.
        // After a completed turn, sustained silence with nothing waiting on the
        // user forces the release, letting the CLI exit and the loop end with a
        // normal `complete`. A pending permission prompt counts as activity —
        // the user may take hours, and the CLI deserves a fresh window after
        // they answer.
        let lastStreamActivityAt = Date.now();
        let turnResultSeen = false;
        let sawSessionStateEvent = false;
        // Tool-use ids streamed by the CLI that have not yet received a matching
        // tool_result. While this is non-empty the CLI is actively working on a
        // tool (or blocked on the user for an interactive one like
        // AskUserQuestion / ExitPlanMode, whose tool_result only arrives after
        // the user answers). Releasing the held-open input in that state closes
        // the CLI's stdin mid-tool and the pending permission response lands in
        // a dead channel — "Tool permission request failed: AbortError: Stream
        // closed". This is the authoritative activity signal and does not depend
        // on the racy pending-approval registration or timing guesses: it covers
        // both the interactive-tool idle race AND a long-running tool (e.g. a
        // Vercel CLI call hanging for minutes) that would otherwise trip the
        // silence-based idle fallback below.
        const outstandingToolUseIds = new Set();
        idleFallbackTimer = setInterval(() => {
          if (inputReleased || !turnResultSeen) return;
          if (outstandingToolUseIds.size > 0) {
            lastStreamActivityAt = Date.now();
            return;
          }
          const sid = capturedSessionId || sessionId || null;
          if (sid && getPendingApprovalsForSession(sid).length > 0) {
            lastStreamActivityAt = Date.now();
            return;
          }
          const silentForMs = Date.now() - lastStreamActivityAt;
          const threshold = sawSessionStateEvent ? IDLE_FALLBACK_SILENCE_MS : IDLE_FALLBACK_NO_STATE_EVENTS_MS;
          if (silentForMs < threshold) return;
          console.warn(`[Claude SDK] No 'idle' event and no stream activity for ${Math.round(silentForMs / 1000)}s after the turn result — releasing held-open input (session: ${sid || 'NEW'})`);
          releaseInput();
        }, IDLE_FALLBACK_CHECK_INTERVAL_MS);

        // Process streaming messages
        console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
        for await (const message of queryInstance) {
          anyMessageReceived = true;
          lastStreamActivityAt = Date.now();
          if (message.type === 'result') {
            turnResultSeen = true;
          }

          // Track open tool calls: a tool_use block is outstanding until its
          // tool_result streams back. Shape-tolerant scan of the Anthropic
          // message payload (assistant → tool_use, user → tool_result). Used by
          // the release guards to keep stdin open while any tool is in flight.
          {
            const content = Array.isArray(message?.message?.content) ? message.message.content : null;
            if (content) {
              for (const block of content) {
                if (block?.type === 'tool_use' && block.id) {
                  outstandingToolUseIds.add(block.id);
                } else if (block?.type === 'tool_result' && block.tool_use_id) {
                  outstandingToolUseIds.delete(block.tool_use_id);
                }
              }
            }
          }

          // Authoritative turn-over signal: fires only after the result flushed
          // AND background agents drained. Releasing here lets the prompt
          // generator finish, so the SDK closes the CLI's stdin and the idle CLI
          // exits, ending this loop. Releasing any earlier (e.g. on `result`)
          // would kill the control channel while background-task turns can still
          // follow — the original AskUserQuestion "Stream closed" bug.
          if (message.type === 'system' && message.subtype === 'session_state_changed') {
            sawSessionStateEvent = true;
            if (message.state === 'idle') {
              // Interactive tools (AskUserQuestion, ExitPlanMode) make the CLI
              // emit `idle` WHILE a permission prompt is still pending in the
              // browser — the CLI has nothing to compute, it's blocked on the
              // user. Releasing input here would close the CLI's stdin and tear
              // down the stdio control channel, so when the user finally answers
              // the SDK writes the response into a dead channel and it fails with
              // "AbortError: Stream closed". Mirror the idle-fallback timer's
              // guard: defer the release while approvals are outstanding. Once
              // the user answers, a later idle (or the fallback timer) releases.
              const sid = capturedSessionId || sessionId || null;
              if (outstandingToolUseIds.size > 0) {
                // A tool is still in flight (interactive tool blocked on the
                // user, or a long tool call). The CLI can emit `idle` here
                // because it has nothing to compute while waiting — do not
                // release; the tool_result (or the next idle) will clear it.
                lastStreamActivityAt = Date.now();
              } else if (sid && getPendingApprovalsForSession(sid).length > 0) {
                lastStreamActivityAt = Date.now();
              } else {
                // No approval is pending RIGHT NOW — but the control request
                // may still be in flight behind this idle event (see
                // RELEASE_GRACE_MS). Defer the release and re-check at fire
                // time: bail if input was already released, if newer stream
                // activity arrived after this idle, or if an approval got
                // registered meanwhile. Otherwise really release.
                const idleAt = lastStreamActivityAt;
                setTimeout(() => {
                  if (inputReleased) return;
                  if (lastStreamActivityAt > idleAt) return;
                  if (outstandingToolUseIds.size > 0) {
                    lastStreamActivityAt = Date.now();
                    return;
                  }
                  const sidNow = capturedSessionId || sessionId || null;
                  if (sidNow && getPendingApprovalsForSession(sidNow).length > 0) {
                    lastStreamActivityAt = Date.now();
                    return;
                  }
                  releaseInput();
                }, RELEASE_GRACE_MS);
              }
            }
          }

          // Capture session ID from first message
          if (message.session_id && !capturedSessionId) {

            capturedSessionId = message.session_id;
            addSession(capturedSessionId, queryInstance, ws, runControls);
            // New chat pinned MCPs before its id existed — record them now so
            // follow-up turns in this chat stay pinned (Kimi MCP stickiness).
            if (pinnedMcpThisRun.size) {
              let set = KIMI_PINNED_MCP_BY_SESSION.get(capturedSessionId);
              if (!set) KIMI_PINNED_MCP_BY_SESSION.set(capturedSessionId, (set = new Set()));
              for (const server of pinnedMcpThisRun) set.add(server);
            }

            // Set session ID on writer
            if (ws.setSessionId && typeof ws.setSessionId === 'function') {
              ws.setSessionId(capturedSessionId);
            }

            // Send session-created event only once for new sessions
            if (!sessionId && !sessionCreatedSent) {
              sessionCreatedSent = true;
              ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
            }
          } else {
            // session_id already captured
          }

          // Transform and normalize message via adapter
          const transformedMessage = transformMessage(message);
          const sid = capturedSessionId || sessionId || null;

          // Use adapter to normalize SDK events into NormalizedMessage[]
          const normalized = sessionsService.normalizeMessage('claude', transformedMessage, sid);
          for (const msg of normalized) {
            // Preserve parentToolUseId from SDK wrapper for subagent tool grouping
            if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
              msg.parentToolUseId = transformedMessage.parentToolUseId;
            }
            ws.send(msg);
          }

          // Extract and send token budget updates from assistant/result usage payloads
          const tokenBudgetData = extractTokenBudget(message);
          if (tokenBudgetData) {
            ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
          }
        }
        break;
      } catch (runError) {
        const isSpawnRace = CLI_SPAWN_RACE_PATTERN.test(runError?.message || '');
        if (idleFallbackTimer) {
          clearInterval(idleFallbackTimer);
          idleFallbackTimer = null;
        }
        if (isSpawnRace && !anyMessageReceived && spawnRaceAttempt < 1) {
          spawnRaceAttempt += 1;
          console.warn(`[Claude SDK] CLI binary mid-update, retrying spawn in ${CLI_SPAWN_RACE_RETRY_DELAY_MS}ms:`, runError.message);
          await sleep(CLI_SPAWN_RACE_RETRY_DELAY_MS);
          continue;
        }

        // Anthropic wobbled (529 overloaded, 5xx, dropped connection): resend
        // the turn instead of ending the run with an error the user can only
        // answer by re-sending it themselves.
        const sid = capturedSessionId || sessionId || null;
        const retryDelayMs = TRANSIENT_RETRY_DELAYS_MS[transientRetryAttempt];
        if (retryDelayMs === undefined
          || !isTransientRunFailure(runError?.message)
          || (sid && abortedSessionIds.has(sid))) {
          throw runError;
        }
        transientRetryAttempt += 1;

        const waitSeconds = Math.round(retryDelayMs / 1000);
        console.warn(`[Claude SDK] Transient failure — resuming the run in ${waitSeconds}s (attempt ${transientRetryAttempt}/${TRANSIENT_RETRY_DELAYS_MS.length}, session: ${sid || 'NEW'}):`, runError?.message);
        ws.send(createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content: `⏳ Серверы Anthropic перегружены — повторяю запрос сам через ${waitSeconds} с (попытка ${transientRetryAttempt} из ${TRANSIENT_RETRY_DELAYS_MS.length}). Делать ничего не надо.`,
          sessionId: sid,
          provider: 'claude'
        }));

        // Resume rather than start over: a brand-new chat got its session id
        // mid-run, and the retry must land in that same chat, keeping whatever
        // the agent already managed to do.
        if (capturedSessionId) {
          sdkOptions.resume = capturedSessionId;
        }

        // The dead query instance can no longer be interrupted, so "Stop" in the
        // UI would quietly do nothing for the whole pause. Stand in for it: the
        // stub cancels the wait, then the abort path finishes the run normally.
        let cancelWait = () => {};
        if (sid) {
          addSession(sid, { interrupt: async () => cancelWait() }, ws, runControls);
        }
        await new Promise(resolve => {
          const timer = setTimeout(resolve, retryDelayMs);
          cancelWait = () => { clearTimeout(timer); resolve(); };
        });
        if (sid && abortedSessionIds.has(sid)) {
          throw runError;
        }
      }
    }

    // Clean up session on completion
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Send the terminal completion event — skipped for aborted runs, whose
    // terminal `complete` (aborted: true) was already sent by abort-session.
    const wasAborted = capturedSessionId ? abortedSessionIds.delete(capturedSessionId) : false;
    if (!wasAborted) {
      ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
    }
    notifyRunStopped({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      stopReason: wasAborted ? 'aborted' : 'completed'
    });
    // Persist how this run ended so history reload can show it even if the
    // client was disconnected when the terminal event fired.
    recordRunOutcome(capturedSessionId || sessionId || null, {
      status: wasAborted ? 'aborted' : 'completed'
    });
    // Complete

  } catch (error) {
    console.error('SDK query error:', error);

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    const wasAborted = capturedSessionId ? abortedSessionIds.delete(capturedSessionId) : false;
    if (wasAborted) {
      // The abort already produced the terminal complete; a generator throw
      // caused by interrupt() is expected noise, not a user-facing error.
      recordRunOutcome(capturedSessionId || sessionId || null, { status: 'aborted' });
      return;
    }

    // Check if Claude CLI is installed for a clearer error message
    const installed = await providerAuthService.isProviderInstalled('claude');
    // The raw SDK message (e.g. "[ede_diagnostic] result_type=user
    // stop_reason=tool_use") is meaningless to the user. Humanize it to the
    // same clear notice the history reader shows, so a mid-turn interruption
    // always ends with a readable reason instead of a silent stop.
    const errorContent = !installed
      ? 'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code'
      : buildRunInterruptedNotice(error?.message || String(error));

    // Send error to WebSocket, then the terminal complete
    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 1 }));
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      error
    });
    // Persist the RAW failure reason (the history reader humanizes it on
    // reload via buildRunInterruptedNotice; storing the already-humanized text
    // would double-wrap it).
    recordRunOutcome(capturedSessionId || sessionId || null, {
      status: 'failed',
      reason: !installed ? errorContent : (error?.message || String(error))
    });
  } finally {
    // Tells a scheduled hard kill that this run is already over (see
    // abortClaudeSDKSession) — the CLI must not be shot down after it exited.
    runState.finished = true;
    if (idleFallbackTimer) {
      clearInterval(idleFallbackTimer);
    }
    releaseInput();
  }
}

/**
 * Aborts an active SDK session — for real, not just by asking.
 *
 * Three stages, cheapest first:
 *  1. `interrupt()` — the clean stop. The CLI closes the turn itself and the
 *     on-disk transcript stays resumable (see abortAllActiveClaudeSDKSessions
 *     for what a hard kill costs when skipped). Bounded by a timeout: a wedged
 *     control channel must not make Stop hang.
 *  2. release the held-open stdin, so an interrupted CLI can exit instead of
 *     idling with the control channel open.
 *  3. kill the process, if the run is still alive a moment later. Stage 1 is
 *     advisory and silently no-ops often enough (model mid-block, dead control
 *     channel) that without this "Stop" would keep spending tokens and editing
 *     files behind a chat that already looks stopped.
 *
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if the session was found and cancellation started
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  console.log(`Aborting SDK session: ${sessionId}`);

  // Mark before interrupting so the run loop knows not to emit its own
  // terminal complete (the abort handler sends the aborted one).
  abortedSessionIds.add(sessionId);
  session.status = 'aborted';
  removeSession(sessionId);

  try {
    await Promise.race([
      session.instance.interrupt(),
      sleep(ABORT_INTERRUPT_TIMEOUT_MS)
    ]);
  } catch (error) {
    // Expected when the query already died (e.g. "Query closed before response
    // received"); the stages below still apply.
    console.warn(`Interrupt failed for session ${sessionId}:`, error?.message || error);
  }

  try {
    session.releaseInput?.();
  } catch (error) {
    console.warn(`Releasing input failed for session ${sessionId}:`, error?.message || error);
  }

  const { abortController, runState } = session;
  if (abortController && runState) {
    const hardKillTimer = setTimeout(() => {
      if (runState.finished || abortController.signal.aborted) {
        return;
      }
      console.warn(`[Claude SDK] Interrupt did not end the run — killing the CLI process (session: ${sessionId})`);
      abortController.abort();
    }, ABORT_HARD_KILL_DELAY_MS);
    // Never keep the process alive just to shoot down a run.
    hardKillTimer.unref?.();
  }

  return true;
}

/**
 * Gracefully interrupts every active SDK session before the process exits.
 *
 * Root cause of the recurring `[ede_diagnostic] ... stop_reason=tool_use`
 * failures: a server restart (deploy, crash, watchdog) used to call
 * `process.exit()` directly, killing every child CLI process mid-turn with no
 * chance to run `interrupt()`. `interrupt()` is an RPC to the CLI
 * (`subtype: 'interrupt'`) that lets it append a synthetic tool_result and
 * close the turn cleanly; skipping it leaves the on-disk session transcript
 * with a dangling `tool_use` and no matching `tool_result`. Every future
 * resume of that exact session then fails instantly, because the CLI can't
 * validate the broken transcript — hence the same error "repeating" across
 * unrelated turns. Calling this from the shutdown handler, before
 * `process.exit()`, fixes the transcript at the source instead of just
 * humanizing the resulting error.
 * @param {number} timeoutMs - Upper bound so a stuck CLI can't block shutdown
 * @returns {Promise<void>}
 */
async function abortAllActiveClaudeSDKSessions(timeoutMs = 5000) {
  const sessionIds = getAllSessions();
  if (sessionIds.length === 0) {
    return;
  }
  console.log(`[Claude SDK] Gracefully interrupting ${sessionIds.length} active session(s) before shutdown`);
  await Promise.race([
    Promise.allSettled(sessionIds.map((id) => abortClaudeSDKSession(id))),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Get pending tool approvals for a specific session.
 * @param {string} sessionId - The session ID
 * @returns {Array} Array of pending permission request objects
 */
function getPendingApprovalsForSession(sessionId) {
  const pending = [];
  for (const [requestId, resolver] of pendingToolApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input,
        context: resolver._context,
        sessionId,
        receivedAt: resolver._receivedAt || new Date(),
      });
    }
  }
  return pending;
}

/**
 * Reconnect a session's WebSocketWriter to a new raw WebSocket.
 * Called when client reconnects (e.g. page refresh) while SDK is still running.
 * @param {string} sessionId - The session ID
 * @param {Object} newRawWs - The new raw WebSocket connection
 * @returns {boolean} True if writer was successfully reconnected
 */
function reconnectSessionWriter(sessionId, newRawWs) {
  const session = getSession(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  session.writer.updateWebSocket(newRawWs);
  console.log(`[RECONNECT] Writer swapped for session ${sessionId}`);
  return true;
}

// Export public API
export {
  matchesToolPermission,
  queryClaudeSDK,
  abortClaudeSDKSession,
  abortAllActiveClaudeSDKSessions,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter
};

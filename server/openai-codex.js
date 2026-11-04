/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { Codex } from '@openai/codex-sdk';

import { resolveBundledCodex } from './shared/codex-paths.js';
import { CodexSubagentTracker, codexHelperPayload } from './modules/providers/list/codex/codex-subagents.js';
import { createCodexBackgroundTaskTracker, pickCodexExecProcess } from './modules/providers/list/codex/codex-background-tasks.js';
import { codexMeterMessage } from './modules/providers/list/codex/codex-usage.js';
import { readCodexContextBudget } from './shared/context-budget.js';
import { CODEX_SDK_EFFORTS, codexRunPolicy, mapPermissionModeToCodexOptions } from './shared/codex-work-mode.js';
import { shouldYieldForUser } from './shared/turn-ending.js';
import { buildCodexInputItems, normalizeImageDescriptors } from './shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { createCompleteMessage, createNormalizedMessage } from './shared/utils.js';
import { withThreadsEnv } from './shared/threads-env.js';
import { buildJailProfile, codexJailWrapperPath, jailInstruction, prepareCodexHome } from './shared/user-jail.js';
import {
  commandMatcher,
  findDescendantProcess,
  findDescendantProcesses,
  markStoppableTasks,
  stopEngineTask,
} from './shared/process-tree.js';

const activeCodexSessions = new Map();

// «Фон: N» of each live Codex turn, by thread id: `{ tracker, published }`,
// `published` = the last list sent (with each row's «Стоп» flag).
const codexBackgroundTasks = new Map();

/** Background commands of a live Codex turn (empty once the turn is over). */
export function getCodexBackgroundTasks(sessionId) {
  const state = codexBackgroundTasks.get(sessionId);
  return state ? (state.published ?? state.tracker.list()) : [];
}

/**
 * The `codex exec` process of a run, found once among Neo3's descendants
 * (the SDK keeps its child to itself). Null when it cannot be told apart.
 */
async function resolveCodexExecPid(run) {
  if (!run) return null;
  if (run.codexPid) return run.codexPid;
  const candidates = await findDescendantProcesses(process.pid, (command) => command.includes(' exec --experimental-json'));
  const claimed = new Set();
  for (const other of activeCodexSessions.values()) {
    if (other !== run && other.status === 'running' && other.codexPid) claimed.add(other.codexPid);
  }
  const pid = pickCodexExecProcess(candidates, { workingDirectory: run.workingDirectory, threadId: run.resumeThreadId, claimed });
  if (pid) run.codexPid = pid;
  return pid;
}

/** Is the command of this background task a live process under the turn's `codex exec`? */
async function codexTaskProcessFound(run, tracker, taskId) {
  const command = tracker.commandOf(taskId);
  if (!run || run.status !== 'running' || !command) return false;
  const rootPid = await resolveCodexExecPid(run);
  return Boolean(rootPid && await findDescendantProcess(rootPid, commandMatcher(command)));
}

/**
 * «Стоп» of one Codex background command. Codex has no API for it, so the
 * command's own process tree under this turn's `codex exec` is stopped; the
 * turn goes on and Codex sees the command end.
 * @returns {Promise<{ok: boolean, reason?: 'turn_ended'|'not_running'|'failed'|'unsupported'}>}
 */
export async function stopCodexTask(sessionId, taskId) {
  const run = activeCodexSessions.get(sessionId);
  const state = codexBackgroundTasks.get(sessionId);
  const running = run?.status === 'running';
  return stopEngineTask({
    running,
    hasTask: Boolean(state?.tracker.has(taskId)),
    rootPid: running ? await resolveCodexExecPid(run) : null,
    command: state?.tracker.commandOf(taskId) ?? null,
  });
}

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object} - Transformed event for WebSocket
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: item.text
            }
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.thread_id || event.id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Codex SDK client options for one run. `env` is the full host env plus this
 * run's thread identity (NEO3_THREADS_TOKEN / NEO3_THREADS_API_URL); the SDK
 * uses it INSTEAD of process.env, so everything else is copied. Codex hands
 * MCP servers only whitelisted variables — the neo3-threads registration
 * lists them in `env_vars` (see modules/threads/threads-mcp-registration.ts).
 */
export function buildCodexClientOptions(options = {}, policy = {}) {
  const env = {};
  for (const [name, value] of Object.entries(withThreadsEnv({ ...process.env }, options))) {
    if (typeof value === 'string') {
      env[name] = value;
    }
  }
  // Shared hooks distinguish Neo3-owned runs from independent terminal sessions.
  env.NEO3_SESSION = '1';
  if (!options.jail?.root) {
    return { config: { developer_instructions: policy.instructions }, env };
  }
  // Non-admin run: the SDK starts a wrapper that execs the bundled binary
  // inside the project jail (server/shared/user-jail.ts). The SDK drops its
  // own PATH additions for an override, so they are put back here.
  const bundled = resolveBundledCodex();
  env.NEO3_JAIL_PROFILE = buildJailProfile(options.jail);
  env.NEO3_JAIL_REAL = bundled.executablePath;
  env.NEO3_JAIL_ROOT = options.jail.root;
  // The teammate's own Codex folder: Dima's chats and MCP servers stay out.
  env.CODEX_HOME = prepareCodexHome(options.jail, undefined, options.teamTelegram?.url);
  if (options.teamTelegram?.token) {
    env.NEO3_TEAM_TELEGRAM_TOKEN = options.teamTelegram.token;
  }
  if (bundled.pathDirs.length > 0) {
    env.PATH = [...bundled.pathDirs, env.PATH ?? ''].filter(Boolean).join(path.delimiter);
  }
  return {
    codexPathOverride: codexJailWrapperPath(),
    config: { developer_instructions: [policy.instructions, jailInstruction(options.jail)].filter(Boolean).join('\n\n') },
    env,
  };
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryCodex(command, options = {}, ws) {
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    effort,
    images,
    workMode,
    permissionMode = 'default'
  } = options;

  const catalog = (await providerModelsService.getProviderModels('codex')).models;
  const resolvedModel = (await providerModelsService.resolveResumeModel(
    'codex',
    sessionId,
    model,
  )) || catalog.DEFAULT;
  const resolvedRequestedEffort = await providerModelsService.resolveResumeEffort(
    'codex',
    sessionId,
    effort,
    resolvedModel,
  );

  const workingDirectory = cwd || projectPath || process.cwd();
  const codexModes = mapPermissionModeToCodexOptions(workMode === 'interrogate' ? 'plan' : permissionMode);
  const { approvalPolicy } = codexModes;
  // Seatbelt cannot nest: inside the project jail Codex's own sandbox would
  // fail every command. The jail takes over; read-only stays read-only.
  const jail = options.jail?.root
    ? { ...options.jail, readOnly: codexModes.sandboxMode === 'read-only' }
    : null;
  const sandboxMode = jail ? 'danger-full-access' : codexModes.sandboxMode;
  const selectedModel = catalog.OPTIONS.find((option) => option.value === resolvedModel) || null;
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value)
    ?? (!selectedModel ? CODEX_SDK_EFFORTS : []);
  const resolvedEffort = typeof resolvedRequestedEffort === 'string'
    && resolvedRequestedEffort !== 'default'
    && allowedEfforts.includes(resolvedRequestedEffort)
    ? resolvedRequestedEffort
    : selectedModel?.effort?.default;

  let codex;
  let thread;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let terminalFailure = null;
  let waitingForUser = false;
  let turnCompleted = false;
  let activeRun = null;
  const abortController = new AbortController();
  const externalSignal = options.signal instanceof AbortSignal ? options.signal : null;
  const signal = externalSignal ? AbortSignal.any([abortController.signal, externalSignal]) : abortController.signal;
  const subagents = new CodexSubagentTracker();
  const turnEventPrefix = randomUUID();
  // «Фон: N»: commands this turn left running in the background.
  const background = { tracker: createCodexBackgroundTaskTracker(), published: null };
  let backgroundPublishSeq = 0;
  let backgroundParseFailureLogged = false;
  const sendBackgroundTasks = (tasks) => {
    background.published = tasks;
    sendMessage(ws, createNormalizedMessage({ kind: 'background_tasks', tasks, sessionId: capturedSessionId || sessionId || null, provider: 'codex' }));
  };
  // Each row gets its own «Стоп» flag: only a command whose process is found.
  // The list goes out at once (no «Стоп» yet), then again if a process was found.
  const publishBackgroundTasks = (tasks) => {
    const seq = ++backgroundPublishSeq;
    sendBackgroundTasks(tasks.map((task) => ({ ...task, stoppable: false })));
    if (tasks.length === 0) return;
    void markStoppableTasks(tasks, (task) => codexTaskProcessFound(activeRun, background.tracker, task.taskId))
      .then((marked) => {
        if (seq === backgroundPublishSeq && marked.some((task) => task.stoppable)) sendBackgroundTasks(marked);
      })
      .catch(() => {});
  };

  try {
    const policy = codexRunPolicy(workMode, permissionMode, { model: resolvedModel, effort: resolvedEffort });
    codex = new Codex(buildCodexClientOptions({ ...options, jail }, policy));

    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model: resolvedModel,
      modelReasoningEffort: resolvedEffort,
    };

    if (sessionId) {
      thread = codex.resumeThread(sessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    const registerSession = (id) => {
      if (!id) {
        return;
      }
      activeRun = {
        thread,
        codex,
        status: 'running',
        abortController,
        startedAt: new Date().toISOString(),
        // For finding this turn's `codex exec` process («Стоп» of a background command).
        workingDirectory,
        resumeThreadId: sessionId || null,
        codexPid: null,
      };
      activeCodexSessions.set(id, activeRun);
      codexBackgroundTasks.set(id, background);
    };

    if (capturedSessionId) {
      registerSession(capturedSessionId);
    }

    // Execute with streaming. Turns with image attachments send structured
    // input items so Codex reads the images from their local asset paths.
    const turnInput = normalizeImageDescriptors(images).length > 0
      ? buildCodexInputItems(command, images, workingDirectory)
      : command;
    const streamedTurn = await thread.runStreamed(turnInput, {
      signal
    });

    for await (const event of streamedTurn.events) {
      // Capture thread/session id lazily from the stream (Codex emits this asynchronously).
      if (event.type === 'thread.started') {
        const discoveredSessionId = event.thread_id || event.id || null;
        if (discoveredSessionId && !capturedSessionId) {
          capturedSessionId = discoveredSessionId;
          registerSession(capturedSessionId);

          if (ws.setSessionId && typeof ws.setSessionId === 'function') {
            ws.setSessionId(capturedSessionId);
          }

          if (!sessionId && !sessionCreatedSent) {
            sessionCreatedSent = true;
            sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'codex' }));
          }
        }
      }

      // Check if session was aborted
      if (signal.aborted) {
        break;
      }
      if (capturedSessionId) {
        const session = activeCodexSessions.get(capturedSessionId);
        if (session?.status === 'aborted') {
          break;
        }
      }

      // exec emits transport recovery notices as errors even though the turn
      // continues. Only recognize its explicit retry/fallback notices; a real
      // turn.failed, unknown error, or EOF must still fail the run.
      const notice = event.type === 'error' ? event.message
        : event.item?.type === 'error' ? event.item.message : null;
      const retry = typeof notice === 'string' && /^Reconnecting\.{3}\s+(\d+\/\d+)(?:\s|$)/.exec(notice);
      const fallback = typeof notice === 'string' && notice.startsWith('Falling back from WebSockets to HTTPS transport.');
      if (retry || fallback) {
        sendMessage(ws, createNormalizedMessage({
          kind: 'status', provider: 'codex', sessionId: capturedSessionId || sessionId || null,
          text: retry ? `Codex: восстанавливаю соединение (${retry[1]})…`
            : 'Codex: переключаю соединение на HTTPS…',
        }));
        continue;
      }

      // «Фон: N». A parsing slip must never touch the run.
      try {
        const tasks = background.tracker.apply(event);
        if (tasks) publishBackgroundTasks(tasks);
      } catch (error) {
        if (!backgroundParseFailureLogged) {
          backgroundParseFailureLogged = true;
          console.warn(`[Codex] «Фон» could not read a stream event: ${error instanceof Error ? error.name : typeof error}`);
        }
      }

      const helper = codexHelperPayload(event);
      if (helper) {
        const helperId = event.item?.id || event.id || JSON.stringify(helper);
        for (const row of subagents.record(helper, capturedSessionId || sessionId || null, `${turnEventPrefix}:${helperId}`, event.timestamp, `${turnEventPrefix}:`)) sendMessage(ws, row);
        continue;
      }

      if (event.item?.type === 'collab_tool_call') {
        for (const row of subagents.event({ ...event.item, id: `${turnEventPrefix}:${event.item.id}` }, capturedSessionId || sessionId || null, resolvedModel)) sendMessage(ws, row);
        continue;
      }

      if ((event.type === 'item.started' || event.type === 'item.updated')
        && !['command_execution', 'mcp_tool_call', 'file_change', 'web_search', 'todo_list'].includes(event.item?.type)) {
        continue;
      }

      const transformed = transformCodexEvent(event);
      if (event.item?.id) transformed.uuid = `${turnEventPrefix}:${event.item.id}`;
      // Search/todo items have no native status; preserve their SDK lifecycle.
      if (event.item && ['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
        transformed.status = event.item.status || (event.type === 'item.completed' ? 'completed' : 'in_progress');
      }

      // Normalize the transformed event into NormalizedMessage(s) via adapter
      const normalizedMsgs = sessionsService.normalizeMessage('codex', transformed, capturedSessionId || sessionId || null);
      for (const msg of normalizedMsgs.flatMap((row) => subagents.message(row))) {
        // Only the executor emits completion, after CLI cleanup. A duplicate
        // adapter completion can flush the next user turn while this one lives.
        if (msg.kind === 'complete') continue;
        sendMessage(ws, msg);
        if (msg.kind === 'text' && msg.role === 'assistant' && shouldYieldForUser(msg.content || '')) {
          waitingForUser = true;
        }
      }
      if (waitingForUser) {
        // exec has no answer channel. Close it at the question boundary so the
        // composer can send the user's answer immediately in the same session.
        abortController.abort();
        break;
      }

      if ((event.type === 'turn.failed' || event.type === 'error') && !terminalFailure) {
        terminalFailure = event.error || new Error(event.message || 'Turn failed');
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: capturedSessionId || sessionId || null,
          sessionName: sessionSummary,
          error: terminalFailure
        });
      }

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed') {
        turnCompleted = true;
        options.meter?.addMessage(codexMeterMessage(event.usage, resolvedModel, capturedSessionId || undefined));
        const tokenBudget = readCodexContextBudget(event);
        if (tokenBudget) {
          sendMessage(ws, createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget, sessionId: capturedSessionId || sessionId || null, provider: 'codex' }));
        }
      }
    }

    if (!turnCompleted && !terminalFailure && !signal.aborted) {
      throw new Error('Codex stream ended before turn.completed. The response may be incomplete.');
    }

  } catch (error) {
    // Only our own cancellation signal proves a user stop/question boundary.
    // A network AbortError (or an error mentioning "aborted") is still a failure.
    const wasAborted = signal.aborted || activeRun?.status === 'aborted';

    if (!wasAborted) {
      console.error('[Codex] Error:', error);

      // Check if Codex SDK is available for a clearer error message
      let installed = true;
      try { resolveBundledCodex(); } catch { installed = false; }
      const errorContent = !installed
        ? 'Codex CLI is not configured. Please set up authentication first.'
        : error.message;

      if (!terminalFailure) {
        sendMessage(ws, createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'codex' }));
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: capturedSessionId || sessionId || null,
          sessionName: sessionSummary,
          error
        });
      }
      terminalFailure ??= error;
    }

  } finally {
    // Release before publishing complete: a writer may immediately start the
    // next turn. Never mutate that newer run through the shared session map.
    const userAborted = activeRun?.status === 'aborted' || externalSignal?.aborted;
    if (activeRun) activeRun.status = userAborted ? 'aborted' : terminalFailure ? 'failed' : 'completed';
    // The exec process is gone, and its background commands with it.
    for (const [id, state] of codexBackgroundTasks) {
      if (state === background) codexBackgroundTasks.delete(id);
    }
    backgroundPublishSeq += 1;
    if (background.tracker.list().length > 0 || (background.published?.length ?? 0) > 0) sendBackgroundTasks([]);
    if (!userAborted) {
      sendMessage(ws, createCompleteMessage({
        provider: 'codex', sessionId: capturedSessionId || sessionId || null,
        actualSessionId: capturedSessionId || thread?.id || sessionId || null,
        exitCode: terminalFailure ? 1 : 0,
      }));
      if (!terminalFailure) notifyRunStopped({
        userId: ws?.userId || null, provider: 'codex',
        sessionId: capturedSessionId || sessionId || null,
        sessionName: sessionSummary, stopReason: waitingForUser ? 'question' : 'completed',
      });
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  const session = activeCodexSessions.get(sessionId);

  if (!session || session.status !== 'running') {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions() {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt
      });
    }
  }

  return sessions;
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically.
// unref'd on purpose: this timer must not be the reason the process stays alive.
// Anything that merely imports this module — a test file, a scheduled run, the
// pipeline runner — would otherwise never exit on its own.
const codexSessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

codexSessionCleanupTimer.unref();

import { workspaceSessionHasGrant } from '../../agent-workspace/index.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { WebSocket } from 'ws';

import { backgroundHoldMs, countBackgroundTasks } from '@/modules/background-tasks/index.js';
import { agentsDb, projectsDb, sessionLinksDb, sessionsDb, sessionThreadsDb } from '@/modules/database/index.js';
import { newRunId, recordAuditEvent, RunMeter } from '@/modules/governance/index.js';
import {
  pendingAnswers,
  type AnswerDeliverer,
  type AnswerEngine,
  type AnswerReason,
  type PendingRequestInfo,
} from '@/modules/pending-answers/index.js';
import { sessionAttention } from '@/modules/session-attention/index.js';
import { lastRunOptions, rememberRunOptions } from '@/modules/auto-relay/index.js';
import { IdeaError, type IdeaRunControl } from '@/modules/improvement-ideas/index.js';
import type { AutoRelayRunControl } from '@/modules/auto-relay/index.js';
import { threadTokens } from '@/modules/threads/index.js';
import { beginServiceTurn } from '@/shared/service-turns.js';

import { isRelayRequestText } from '../../../../shared/relay-rules.js';
import type { ThreadRunControl } from '@/modules/threads/index.js';
import type { AgentRunControl } from '@/modules/agents/index.js';
import { QUEUED_MESSAGE_FOREIGN, queuedMessagesService, type QueuedSendControl } from '@/modules/queued-messages/index.js';
import { backgroundConsoleOn, chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { clientIdentities, readSocketUserId } from '@/modules/websocket/services/project-access.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import {
  appendAttachedFilesTag,
  appendVisibleImagePathsTag,
  getGlobalImageAssetsDir,
  normalizeImageDescriptors,
  splitAttachmentsByKind,
} from '@/shared/image-attachments.js';
import {
  listGrokQuestionsForAppSession,
  peekGrokPlanExit,
  peekGrokQuestion,
  registerGrokPlanExit,
  registerGrokQuestion,
  rewriteGrokHeadlessQuestionStub,
  serializeGrokQuestionAnswers,
  takeGrokPlanExit,
  takeGrokQuestion,
  takeGrokQuestionsForAppSession,
} from '@/shared/grok-question.js';
import { logChatEvent } from '@/shared/chat-event-log.js';
import { formatResetMoscow, type UsageGuardState } from '@/shared/claude-usage.js';
import { isModOn, MOD_OFF, type IsModOn } from '@/shared/mods.js';
import { canAccessSession, isAdminUser } from '@/shared/project-access.js';
import { teamTelegram, teamTelegramUrl } from '@/modules/team-telegram/index.js';
import { teamKie, teamKieUrl } from '@/modules/team-kie/index.js';
import { JAIL_DENIED_MESSAGE, JAIL_PROVIDER_MESSAGE, JAILED_PROVIDERS, userJailFor } from '@/shared/user-jail.js';
import { threadsApiUrl, type ThreadsRunEnv } from '@/shared/threads-env.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  LLMProvider,
  RealtimeClientConnection,
} from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage, parseIncomingJsonObject } from '@/shared/utils.js';

/**
 * Runtimes that build their own image reference block (`appendImagesInputTag`)
 * because their CLI has no vision — the gateway must not add a second one.
 */
const PROVIDERS_WITH_RUNTIME_IMAGE_TAG = new Set<LLMProvider>(['cursor', 'opencode']);

/**
 * Trust boundary for client-supplied image attachments: chat.send options come
 * straight from the browser, and the provider runtimes read the referenced
 * files off disk (Claude base64-encodes them into the prompt). Only images
 * that live directly inside the global upload store (`~/.cloudcli/assets`,
 * where POST /api/assets/images puts them) are allowed through — anything
 * else (absolute paths elsewhere, traversal, subdirectories) is dropped.
 *
 * Exported for tests; `assetsRootOverride` exists only for them.
 */
export function filterImagesToUploadStore(images: unknown, assetsRootOverride?: string): AnyRecord[] {
  const assetsRoot = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());

  return normalizeImageDescriptors(images).filter((descriptor) => {
    // Relative paths are anchored in the store; absolute ones must already be in it.
    const resolved = path.resolve(assetsRoot, descriptor.path);
    const relative = path.relative(assetsRoot, resolved);
    const isDirectChild =
      relative.length > 0 &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !relative.includes(path.sep) &&
      !relative.includes('/');

    if (!isDirectChild) {
      console.warn(`[Chat] Dropping image outside the upload store: ${descriptor.path}`);
    }
    return isDirectChild;
  });
}

/**
 * One provider runtime entry point. All five runtimes share this signature,
 * which lets the chat handler dispatch through a provider-keyed map instead
 * of provider-specific branches.
 */
type ProviderSpawnFn = (
  command: string,
  options: AnyRecord,
  writer: unknown
) => Promise<unknown>;

export type ChatWebSocketDependencies = {
  /** Provider runtimes keyed by provider id. */
  spawnFns: Record<LLMProvider, ProviderSpawnFn>;
  /**
   * Abort functions keyed by provider id. They are addressed with the
   * provider-native session id (that is how runtimes key their process maps).
   * The Claude abort is async; the rest are sync — both shapes are accepted.
   */
  abortFns: Record<LLMProvider, (providerSessionId: string) => boolean | Promise<boolean>>;
  /**
   * Stops one background task of a run (Claude only: background Bash,
   * monitors, subagents). Addressed with the provider-native session id.
   */
  stopTaskFns?: Partial<Record<LLMProvider, (providerSessionId: string, taskId: string) => Promise<StopTaskResult>>>;
  /** Current background tasks of a live run, sent on `chat.subscribe` (Claude only). */
  backgroundTasksFns?: Partial<Record<LLMProvider, (providerSessionId: string) => unknown[]>>;
  /**
   * «Фон доживает до конца» (Claude only): hands a message to the live
   * process of a run that is between turns. False = not taken, nothing was
   * written (mid-turn, input already released, or the run is not held).
   */
  heldInputFns?: Partial<Record<LLMProvider, (providerSessionId: string, payload: HeldInputPayload) => boolean>>;
  /** Ends the hold of a run that is idle between turns; it then completes like a run without the hold. */
  releaseHeldFns?: Partial<Record<LLMProvider, (providerSessionId: string) => boolean>>;
  /** Ceiling of the hold in ms, 0 = off (default: NEO3_CLAUDE_BACKGROUND_HOLD_MS). */
  backgroundHoldMs?: () => number;
  /**
   * Keeps a person's `chat.send` that the chat's live process could not take
   * (default: the message queue's `deferSent`); it leaves when that run ends.
   */
  keepSentMessage?: (sessionId: string, userId: number | null, message: { content: string; options: AnyRecord; images: unknown[] }) => void;
  /**
   * Engines whose runtime refuses a new run by a subscription limit (Claude's
   * 5-hour guard). The queue asks it before it starts a run — a run refused
   * inside the runtime has already taken the message. Absent = nobody is asked.
   */
  usageGuardFns?: Partial<Record<LLMProvider, () => Promise<UsageGuardState>>>;
  resolveToolApproval: (
    requestId: string,
    payload: {
      allow: boolean;
      updatedInput?: unknown;
      message?: string;
      rememberEntry?: unknown;
    }
  ) => void;
  /** Claude-only today: pending tool approvals included in `chat_subscribed`. */
  getPendingApprovalsForSession: (providerSessionId: string) => unknown[];
  /** Claude: one pending approval by request id (`sessionId` = provider-native id). */
  getPendingApprovalById?: (requestId: string) => { sessionId: string | null; input?: unknown } | null;
  /** Mod switches of the run's user (default: their account settings). */
  isModOn?: IsModOn;
  /** Project jail of the run's user (default: server/shared/user-jail.ts). */
  userJailFor?: typeof userJailFor;
};

/** A user message for a held run (see `sendToHeldClaudeRun`). */
export type HeldInputPayload = {
  command: string;
  images: AnyRecord[];
  /** Set only for the relay's handoff request: its note is written without asking. */
  autoRelayNoteDir: string | null;
  /**
   * The composer settings the message asks for. A live process keeps the ones
   * it was started with, so the runtime takes no message that names other
   * ones: it ends the hold instead, and the message starts an ordinary run.
   */
  model?: string;
  effort?: string;
  permissionMode?: string;
};

/** The engine settings of a message, as the composer sent them (absent = not named). */
function engineSettingsOf(options: AnyRecord): Pick<HeldInputPayload, 'model' | 'effort' | 'permissionMode'> {
  const read = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return { model: read(options.model), effort: read(options.effort), permissionMode: read(options.permissionMode) };
}

/**
 * Answer to `chat.stop-task`. `turn_ended` = the turn is over, the task is no
 * longer controllable from here; `not_running` = the task itself is gone.
 */
export type StopTaskResult = { ok: boolean; reason?: string };

/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
function readRequestUserId(
  request: AuthenticatedWebSocketRequest | undefined
): string | number | null {
  return readSocketUserId(request?.user);
}

/** Reads the authenticated request user's role, if present (added alongside userId/username). */
function readRequestUserRole(request: AuthenticatedWebSocketRequest | undefined): string | null {
  const role = request?.user?.role;
  return typeof role === 'string' ? role : null;
}

function sendJson(ws: RealtimeClientConnection, payload: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Reports a protocol-level failure to the requesting client.
 *
 * Protocol errors deliberately use their own `kind` (instead of the provider
 * `error` message kind) so the frontend can distinguish "your request was
 * invalid" from "the model run produced an error" without inspecting text.
 */
function sendProtocolError(
  ws: RealtimeClientConnection,
  code: string,
  error: string,
  sessionId?: string
): void {
  sendJson(ws, {
    kind: 'protocol_error',
    code,
    error,
    sessionId: sessionId ?? null,
    timestamp: new Date().toISOString(),
  });
}

function readRequiredSessionId(data: AnyRecord): string | null {
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  return sessionId.length > 0 ? sessionId : null;
}

/**
 * A refused send names its protocol error code — the same one the socket was
 * told. A started one is either a new run (`finished` = the runtime is done)
 * or a message handed to the live process of a held run (`finished` is
 * already settled: that run's own start owns its end). `MESSAGE_QUEUED` is
 * the one code the socket is not told: the message was kept, not refused.
 */
type ChatSendStart =
  | { started: false; code: string; error: string }
  | { started: true; finished: Promise<void> };

/** Runs a person started: only these are held for their background (and remembered for the relay). */
const HOLD_ACCESS_KINDS: ReadonlySet<ChatSendAccess['kind']> = new Set(['socket', 'queue']);

/**
 * The text and attachments of a message as the engine gets them. Client
 * attachments are re-validated to the upload store, then split: images ride
 * along as vision blocks (per provider), while other files are referenced by
 * path in an <attached_files> block the agent reads with its own tools.
 */
function buildRunCommand(provider: LLMProvider, rawContent: string, clientOptions: AnyRecord) {
  const { images: imageAttachments, files: fileAttachments } = splitAttachmentsByKind(
    filterImagesToUploadStore(clientOptions.images)
  );
  const commandWithFiles = appendAttachedFilesTag(rawContent, fileAttachments);
  // Runtimes that show the picture to the model (Claude, Codex) used to pass the
  // image and nothing else, leaving the agent unable to name the file it can
  // see — so it could not feed it to a tool (`vis --ref`, ffmpeg, an upload).
  // Cursor and OpenCode are left alone: they have no vision and already append
  // their own "read these files" block inside the runtime.
  const command = PROVIDERS_WITH_RUNTIME_IMAGE_TAG.has(provider)
    ? commandWithFiles
    : appendVisibleImagePathsTag(commandWithFiles, imageAttachments);
  return { command, imageAttachments, fileAttachments };
}

/** The user's bubble for a message no tab drew (a queued one), as an event of the run. */
function sendQueuedBubble(
  run: NonNullable<ReturnType<typeof chatRunRegistry.getRun>>,
  provider: LLMProvider,
  rawContent: string,
  clientOptions: AnyRecord,
): void {
  run.writer.send(createNormalizedMessage({
    id: `local_queue_${randomUUID()}`,
    kind: 'text',
    role: 'user',
    content: rawContent,
    images: Array.isArray(clientOptions.images) && clientOptions.images.length > 0 ? clientOptions.images : undefined,
    sessionId: run.appSessionId,
    provider,
  }));
}

/**
 * Whose access decides a `chat.send`.
 * - `socket`: the authenticated user of the websocket (`clientIdentities`) —
 *   every request that arrives over a connection, including a panel answer.
 * - `verified-answer`: a detached continuation after an answer from a push or
 *   Telegram. There is no socket identity; the actor was already checked by
 *   `pendingAnswers` against the same project-access rule before delivery.
 * - `thread` / `auto-relay`: runs the server starts for a chat's user (see
 *   canStartLinkedRun).
 * - `agent`: the first message of a chat with a Neo3 agent (see
 *   canStartAgentRun).
 * - `queue`: a message the user queued while the agent was busy, sent by the
 *   server when the turn ended (queued-messages). Checked like a socket send:
 *   by the rights the user has at the moment of sending. `watcher` is the
 *   connection that followed the chat's previous run, if it is still entitled.
 *   `echoed`: the sender's tab drew the bubble itself (a `chat.send` the queue
 *   kept), so the run does not start with a second one.
 */
type ChatSendAccess =
  | { kind: 'socket' }
  | { kind: 'verified-answer' }
  | { kind: 'idea'; userId: number }
  | { kind: 'thread'; userId: number; parentSessionId: string }
  | { kind: 'auto-relay'; userId: number; parentSessionId: string }
  | { kind: 'agent'; userId: number }
  | { kind: 'queue'; userId: number; watcher?: RealtimeClientConnection | null; echoed?: boolean };

/**
 * `agent` access («Агенты»): an admin, with access to the chat's project now,
 * and the chat belongs to one of his own agents (agent_sessions).
 */
function canStartAgentRun(access: { userId: number }, sessionId: string): boolean {
  if (!isAdminUser({ id: access.userId }) || !canAccessSession({ id: access.userId }, sessionId)) {
    return false;
  }
  return agentsDb.agentOfSession(sessionId)?.userId === access.userId;
}

/**
 * `thread` access (agent threads): the actor is the parent chat's user, checked
 * against the project-access rule now, and the target is either the parent
 * itself («Треды готовы») or one of its threads.
 */
function canStartThreadRun(access: { userId: number; parentSessionId: string }, sessionId: string): boolean {
  return canStartLinkedRun(access, sessionId, 'thread');
}

/**
 * Server-started runs on behalf of a chat's user: the actor must have access
 * to the target now, and the target is the chat itself or its child of the
 * given relation — which `linkSession` only allows in the same project
 * (checked again here, the link may predate a project move).
 * `thread`: «Треды готовы» to the parent, or a thread run.
 * `auto-relay`: the handoff request in the chat, or its relay continuation.
 */
function canStartLinkedRun(
  access: { userId: number; parentSessionId: string },
  sessionId: string,
  relation: 'thread' | 'relay',
): boolean {
  if (!canAccessSession({ id: access.userId }, sessionId)) {
    return false;
  }
  if (sessionId === access.parentSessionId) {
    return true;
  }
  const link = sessionLinksDb.getRow(sessionId);
  if (link?.relation !== relation || link.parent_session_id !== access.parentSessionId) {
    return false;
  }
  const parent = sessionLinksDb.getRow(access.parentSessionId);
  return Boolean(parent && parent.project_path && parent.project_path === link.project_path);
}

/**
 * Handles `chat.send`: resolves the session row (provider, project path, and
 * provider-native id all come from the database — never from the client),
 * registers the run, and dispatches to the provider runtime.
 */
async function handleChatSend(
  ws: RealtimeClientConnection,
  userId: string | number | null,
  userRole: string | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const start = beginChatSend(ws, userId, userRole, data, dependencies, { kind: 'socket' });
  if (start.started) {
    await start.finished;
  }
}

/**
 * Synchronous half of `chat.send`: validation, access check and run
 * registration. `started` is the explicit result of registering the run;
 * `finished` settles when the runtime is done. Every attempt — whoever made
 * it — leaves one `send` line in the chat journal (no message text).
 */
function beginChatSend(
  ws: RealtimeClientConnection,
  userId: string | number | null,
  userRole: string | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
  access: ChatSendAccess,
): ChatSendStart {
  const start = startChatSend(ws, userId, userRole, data, dependencies, access);
  logChatEvent('send', {
    sessionId: readRequiredSessionId(data) ?? '',
    userId,
    access: access.kind,
    started: start.started,
    ...(start.started ? {} : { code: start.code }),
  });
  return start;
}

function startChatSend(
  ws: RealtimeClientConnection,
  userId: string | number | null,
  userRole: string | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
  access: ChatSendAccess,
): ChatSendStart {
  const refuse = (code: string, error: string, refusedSessionId?: string): ChatSendStart => {
    sendProtocolError(ws, code, error, refusedSessionId);
    return { started: false, code, error };
  };

  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    return refuse('SESSION_ID_REQUIRED', 'chat.send requires a sessionId.');
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    return refuse(
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`,
      sessionId
    );
  }

  // Non-admin employees may only open sessions for projects an admin granted
  // them via the admin panel — listing already filters the sidebar, but a
  // known/guessed sessionId must not bypass that (see user_project_access).
  // The identity is the socket's authenticated user and the role comes from
  // the database: no user → refused, a session without a project → admins
  // only. The single exception is a detached continuation whose actor
  // `pendingAnswers` has already checked (see ChatSendAccess).
  const accessDenied = access.kind === 'socket'
    ? !canAccessSession(clientIdentities.get(ws), sessionId)
    : access.kind === 'queue'
      ? !canAccessSession({ id: access.userId }, sessionId)
    : access.kind === 'idea'
      ? !isAdminUser({ id: access.userId }) || !canAccessSession({ id: access.userId }, sessionId)
      : access.kind === 'thread'
      ? !canStartThreadRun(access, sessionId)
      : access.kind === 'agent'
      ? !canStartAgentRun(access, sessionId)
      : access.kind === 'auto-relay' && !canStartLinkedRun(access, sessionId, 'relay');
  if (accessDenied) {
    return refuse('PROJECT_ACCESS_DENIED', 'You do not have access to this project.', sessionId);
  }

  const provider = session.provider as LLMProvider;
  const spawnFn = dependencies.spawnFns[provider];
  if (!spawnFn) {
    return refuse('UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
  }

  // Non-admins work inside their project folder only: their engine runs in a
  // macOS sandbox fenced to it (server/shared/user-jail.ts). Engines that
  // cannot be fenced are closed to them.
  const jail = (dependencies.userJailFor ?? userJailFor)(userId, session.project_path);
  if (jail === 'deny') {
    return refuse('PROJECT_JAIL_DENIED', JAIL_DENIED_MESSAGE, sessionId);
  }
  if (jail && !JAILED_PROVIDERS.has(provider)) {
    return refuse('PROJECT_JAIL_PROVIDER', JAIL_PROVIDER_MESSAGE, sessionId);
  }

  const clientOptions = (data.options ?? {}) as AnyRecord;
  const rawContent = typeof data.content === 'string' ? data.content : '';

  // «Фон доживает до конца»: the chat's process is alive between turns — the
  // message goes into it and starts a turn there, the background keeps
  // working. Not taken (mid-turn, input already released, a run that is not
  // held) → the chat is busy, as it always was.
  const liveRun = chatRunRegistry.getRun(sessionId);
  if (liveRun?.status === 'running') {
    const heldInput = dependencies.heldInputFns?.[provider];
    if (heldInput && liveRun.providerSessionId) {
      if (jail) {
        // A fenced user's message never goes into a process that is not
        // fenced for him. The hold ends instead, so the chat frees up within
        // a moment — exactly what he would have seen without the hold.
        dependencies.releaseHeldFns?.[provider]?.(liveRun.providerSessionId);
      } else {
        const { command, imageAttachments } = buildRunCommand(provider, rawContent, clientOptions);
        const relayNote = access.kind === 'auto-relay' && isRelayRequestText(rawContent) && session.project_path
          ? path.join(session.project_path, 'docs', 'handoff')
          : null;
        const payload: HeldInputPayload = {
          command,
          images: imageAttachments,
          autoRelayNoteDir: relayNote,
          ...engineSettingsOf(clientOptions),
        };
        if (heldInput(liveRun.providerSessionId, payload)) {
          // The bookkeeping of a run start, without a new run.
          chatRunRegistry.continueRun(sessionId, access.kind === 'socket' ? ws : null);
          if (access.kind === 'queue' && !access.echoed) {
            sendQueuedBubble(liveRun, provider, rawContent, clientOptions);
          }
          if (access.kind === 'socket' || access.kind === 'idea' || access.kind === 'agent' || access.kind === 'queue') {
            rememberRunOptions(sessionId, clientOptions);
          }
          return { started: true, finished: Promise.resolve() };
        }
      }
    }
    // A person's message for a chat whose process has been between turns. The
    // tab took the chat for free: its field is empty and the bubble is drawn,
    // so a refusal would lose the message (the input was released a moment
    // ago, the agent woke up by itself, the sender may not share the process,
    // the message asks for other settings). It is kept in the server queue
    // and leaves when this turn or run ends — a run that was held always
    // announces that. Runs the server starts are refused as before: threads,
    // the relay and the conveyor rely on it.
    if (access.kind === 'socket' && liveRun.wasHeld) {
      const { images, ...options } = clientOptions;
      const sender = userId === null || !Number.isFinite(Number(userId)) ? null : Number(userId);
      try {
        (dependencies.keepSentMessage ?? queuedMessagesService.deferSent)(
          sessionId,
          sender,
          { content: rawContent, options, images: Array.isArray(images) ? images : [] },
        );
        // The sender follows the chat from here: the end of this run, then the run with the message.
        chatRunRegistry.attachConnection(sessionId, ws);
        return { started: false, code: 'MESSAGE_QUEUED', error: 'Сообщение уйдёт, когда закончится ход.' };
      } catch (error) {
        // The cell holds another user's message: gluing the two would send
        // that text under this sender's name and rights. The chat is busy for
        // him — said in his language, his tab shows the text as it is.
        if ((error as { code?: unknown } | null)?.code === QUEUED_MESSAGE_FOREIGN && error instanceof Error) {
          return refuse('RUN_IN_PROGRESS', error.message, sessionId);
        }
        // Not kept (an empty message, a full cell): the old refusal is the honest answer.
        console.error('[Chat] A sent message could not be kept in the queue', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return refuse('RUN_IN_PROGRESS', `Session "${sessionId}" already has a run in progress.`, sessionId);
  }

  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider,
    providerSessionId: session.provider_session_id,
    connection: ws,
    userId,
    projectId: session.project_path ? projectsDb.getProjectPath(session.project_path)?.project_id ?? null : null,
    canStopTasks: Boolean(dependencies.stopTaskFns?.[provider]),
  });

  if (!run) {
    return refuse('RUN_IN_PROGRESS', `Session "${sessionId}" already has a run in progress.`, sessionId);
  }

  // Typing an answer while Grok's synthetic question panel is up is the
  // supported fallback ("2" as text). Drop the panel so a later click does
  // not start a second resume. Only once the new turn is registered: a send
  // that did not start must not destroy the open questions.
  if (provider === 'grok') {
    for (const pending of takeGrokQuestionsForAppSession(sessionId)) {
      sendJson(ws, createNormalizedMessage({
        kind: 'permission_cancelled',
        requestId: pending.requestId,
        sessionId,
        provider: 'grok',
      }));
    }
  }

  // A queued message has no tab that sent it: nobody drew the user's bubble
  // and no socket follows the run. The connection that watched the previous
  // turn keeps watching, and the bubble is the run's first event — live for
  // that tab, replayed to any tab that subscribes later. The id is a local
  // echo's (`local_*`): the client drops it once the transcript has the row.
  if (access.kind === 'queue') {
    if (access.watcher) {
      run.writer.updateWebSocket(access.watcher);
    }
    // A kept `chat.send` is already on its sender's screen.
    if (!access.echoed) {
      sendQueuedBubble(run, provider, rawContent, clientOptions);
    }
  }

  // Auto-relay repeats a person's engine settings (model, effort, mode, tools)
  // on its own turns; only runs a person started count — a queued message is
  // the person's message too.
  if (access.kind === 'socket' || access.kind === 'idea' || access.kind === 'agent' || access.kind === 'queue') {
    rememberRunOptions(sessionId, clientOptions);
  }

  const { command, imageAttachments, fileAttachments } = buildRunCommand(provider, rawContent, clientOptions);

  // The provider runtimes receive the provider-native session id (that is the
  // id their CLI/SDK understands for resume). Brand-new sessions have no
  // provider id yet, so the runtime starts fresh and announces one, which the
  // gateway writer captures and maps back to the app session id.
  const runtimeOptions: AnyRecord = {
    ...clientOptions,
    // Only image attachments reach the provider runtimes' vision path; non-image
    // files were folded into `command` above as an <attached_files> block.
    images: imageAttachments,
    sessionId: session.provider_session_id ?? undefined,
    // Push notifications deep-link to /session/<app id>, which is what the UI
    // routes on — the provider-native id above would not resolve there.
    appSessionId: sessionId,
    resume: Boolean(session.provider_session_id),
    cwd: userRole === 'admin' ? (clientOptions.cwd ?? session.project_path ?? undefined) : session.project_path ?? undefined,
    projectPath: session.project_path ?? clientOptions.projectPath,
  };
  // Set by the server only: a client cannot send its own `jail` (or `null`).
  delete runtimeOptions.jail;
  delete runtimeOptions.teamTelegram;
  delete runtimeOptions.teamKie;
  // «Фон доживает до конца»: a Claude chat a person started (from the composer
  // or from the queue) keeps its process while background work is alive.
  // Threads, agents, the conveyor, the relay and ideas end as they always did —
  // other modules read their turn ends. A teammate's process is fenced to what
  // its first message needed, so it is not held either.
  delete runtimeOptions.holdBackground;
  if (provider === 'claude'
    && HOLD_ACCESS_KINDS.has(access.kind)
    && !jail
    && (dependencies.backgroundHoldMs ?? backgroundHoldMs)() > 0
    && (dependencies.isModOn ?? isModOn)(userId, 'modBackgroundHold')) {
    runtimeOptions.holdBackground = true;
  }
  if (jail) {
    const assetsRoot = getGlobalImageAssetsDir();
    runtimeOptions.jail = {
      ...jail,
      readFiles: [...imageAttachments, ...fileAttachments].map((attachment) => path.resolve(assetsRoot, String(attachment.path))),
    };
    // Dima's Telegram, read-only, downloads into this project (team-telegram).
    runtimeOptions.teamTelegram = {
      url: teamTelegramUrl(),
      token: teamTelegram.issue({ root: jail.root, userId: Number(userId) || 0 }),
    };
    // Kie.ai with Dima's key kept on the server, for teammates listed in its
    // config (team-kie); the run's team token above is the credential.
    if (teamKie.allowedUser(Number(userId) || 0)) {
      runtimeOptions.teamKie = { url: teamKieUrl() };
    }
  }

  // Auto-relay handoff request: a service turn (no «run stopped» push of its
  // own) that may write its note into docs/handoff/ without asking. Decided
  // here from the access kind and the request text — a client cannot claim it.
  delete runtimeOptions.autoRelayNoteDir;
  const relayServiceTurn = access.kind === 'auto-relay' && isRelayRequestText(rawContent);
  if (relayServiceTurn && session.project_path) {
    runtimeOptions.autoRelayNoteDir = path.join(session.project_path, 'docs', 'handoff');
  }
  const endServiceTurn = relayServiceTurn ? beginServiceTurn(sessionId) : null;

  // One run, one audit trail. The meter rides along in the runtime options and
  // is fed by the engine as usage arrives. Claude and Grok report real usage;
  // other engines still record the run with token counts of zero rather than
  // an invented price.
  const runId = newRunId();
  const meter = new RunMeter();
  const startedAt = Date.now();
  runtimeOptions.meter = meter;

  // Threads: this run's identity for the neo3-threads MCP server, put into the
  // engine env by the runtime (server/shared/threads-env.ts). Valid until the
  // run ends + 24 h. A failure here never blocks the run — it only goes
  // without threads.
  // «Треды» switched off: the run carries the «off» marker, so opening or
  // writing to a thread is refused in plain words. A token is still issued
  // when this chat already has threads — thread_status / stop_thread keep
  // working on them; a chat without threads gets no token at all.
  let threadsToken: string | null = null;
  const threadsOn = (dependencies.isModOn ?? isModOn)(userId, 'modThreads');
  if (threadsOn || sessionThreadsDb.listByParent(sessionId).length > 0 || (userId && workspaceSessionHasGrant(Number(userId), sessionId))) {
    try {
      threadsToken = threadTokens.issue({ sessionId, userId, permissionMode: clientOptions.permissionMode });
    } catch (error) {
      console.error('[Chat] Thread token was not issued', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const threadsEnv: ThreadsRunEnv = {
    ...(threadsToken ? { NEO3_THREADS_TOKEN: threadsToken, NEO3_THREADS_API_URL: threadsApiUrl() } : {}),
    ...(threadsOn ? {} : { NEO3_THREADS_OFF: '1' as const }),
  };
  if (Object.keys(threadsEnv).length > 0) {
    runtimeOptions.threadsEnv = threadsEnv;
  }

  recordAuditEvent({
    actor: 'user',
    event: 'run.start',
    userId: userId === null ? null : Number(userId),
    projectPath: session.project_path ?? null,
    sessionId,
    runId,
    provider,
    model: typeof clientOptions.model === 'string' ? clientOptions.model : null,
    detail: command,
  });

  const finished = (async () => {
    let outcome: 'ok' | 'error' = 'ok';
    let failureDetail: string | null = null;

    try {
      await spawnFn(command, runtimeOptions, run.writer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = 'error';
      failureDetail = message;
      console.error(`[Chat] Provider runtime "${provider}" failed`, { sessionId, error: message });
    } finally {
      endServiceTurn?.();
      try {
        threadTokens.end(threadsToken);
      } catch {
        // The token then expires at the next boot (threadTokens.reconcileOnBoot).
      }
      const cost = meter.finish();
      recordAuditEvent({
        actor: 'user',
        event: outcome === 'error' ? 'run.error' : 'run.finish',
        userId: userId === null ? null : Number(userId),
        projectPath: session.project_path ?? null,
        sessionId,
        runId,
        provider,
        model: cost.model ?? (typeof clientOptions.model === 'string' ? clientOptions.model : null),
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
      // Safety net: a runtime that crashed (or resolved) without emitting its
      // terminal `complete` would otherwise leave the session stuck in
      // "processing" forever on every connected client. Scoped to THIS run —
      // a queued message can start the session's next run before this promise
      // settles, and the session-keyed completeRun would kill that new run.
      chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
    }
  })();

  return { started: true, finished };
}

/**
 * Handles `chat.abort`: cancels the run for one app session and emits the
 * terminal `complete` on its behalf (runtimes skip their own complete for
 * aborted runs, and the registry drops any duplicate).
 */
async function handleChatAbort(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
  userId: string | number | null = null,
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.abort requires a sessionId.');
    return;
  }

  if (!(await abortSessionRun(sessionId, dependencies, userId))) {
    // Stop can arrive after completion or be repeated by another tab. It is
    // already satisfied; acknowledge only to the requester, without changing
    // the saved result or notifying anyone that a successful run failed.
    if (chatRunRegistry.isProcessing(sessionId)) {
      // A new run may have started across the await. Do not stop its spinner.
      handleChatSubscribe(ws, { sessions: [{ sessionId }] }, dependencies, userId);
      return;
    }
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      sendProtocolError(ws, 'SESSION_NOT_FOUND', 'Session not found.', sessionId);
      return;
    }
    sendJson(ws, createCompleteMessage({
      provider: session.provider as LLMProvider,
      sessionId, exitCode: 0, aborted: true,
    }));
  }
}

/**
 * Stops the live run of one app session — the Stop button, also used by
 * `stop_thread`. False when the session has nothing running.
 */
async function abortSessionRun(
  sessionId: string,
  dependencies: ChatWebSocketDependencies,
  userId: string | number | null,
): Promise<boolean> {
  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') {
    logChatEvent('abort', { sessionId, userId, stopped: false });
    return false;
  }
  logChatEvent('abort', { sessionId, userId, stopped: true });

  const abortFn = dependencies.abortFns[run.provider];

  // "Ждут тебя": the aborted session is marked seen for whoever pressed Stop.
  try {
    sessionAttention.recordStopActor(sessionId, userId);
  } catch (error) {
    console.error('[Chat] Session attention stop update failed', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // «Стоп» kills the Claude process with everything it left in the background;
  // the chat is told how much, so nobody waits for an agent that will not come
  // back. Read before the kill, while the list still exists.
  let killedBackground: { agents: number; shells: number } | undefined;
  if (run.provider === 'claude' && run.providerSessionId) {
    try {
      const counts = countBackgroundTasks(
        (dependencies.backgroundTasksFns?.claude?.(run.providerSessionId) ?? []) as Parameters<typeof countBackgroundTasks>[0],
      );
      if (counts.agents + counts.shells > 0) killedBackground = counts;
    } catch (error) {
      console.error('[Chat] Could not count the background of a stopped run', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Complete FIRST, kill second. Marking the run finished fences its event
  // stream (the registry drops everything a still-winding-down runtime emits),
  // so no output can land in the chat after the user pressed Stop — and the
  // UI gets its answer immediately instead of waiting out the interrupt RPC.
  chatRunRegistry.completeRun(sessionId, { exitCode: 0, aborted: true, ...(killedBackground ? { killedBackground } : {}) });

  if (!abortFn) {
    return true;
  }

  if (run.providerSessionId) {
    await abortFn(run.providerSessionId);
    return true;
  }

  // Brand-new chat whose runtime has not announced its native session id yet:
  // there is nothing to address the abort with, so arm it to fire the instant
  // the id arrives. Without this the agent kept running (and kept spending
  // tokens) after a Stop pressed in the first seconds of a chat.
  chatRunRegistry.armPendingAbort(sessionId, (providerSessionId) => {
    void Promise.resolve(abortFn(providerSessionId)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Chat] Deferred abort failed', { sessionId, error: message });
    });
  });
  return true;
}

/**
 * Handles `chat.stop-task`: stops one background task of the session's live
 * run and answers the requester with `background_task_stop`
 * `{sessionId, taskId, ok, reason?}`. Access is checked by the caller.
 */
async function handleChatStopTask(
  ws: RealtimeClientConnection,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
  userId: string | number | null = null,
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.stop-task requires a sessionId.');
    return;
  }
  const taskId = typeof data.taskId === 'string' ? data.taskId.trim() : '';
  if (!taskId) {
    sendProtocolError(ws, 'TASK_ID_REQUIRED', 'chat.stop-task requires a taskId.', sessionId);
    return;
  }

  const reply = (result: StopTaskResult) => sendJson(ws, {
    kind: 'background_task_stop',
    sessionId,
    taskId,
    ok: result.ok,
    ...(result.reason ? { reason: result.reason } : {}),
    timestamp: new Date().toISOString(),
  });

  if (!backgroundConsoleOn(userId, dependencies.isModOn)) {
    reply({ ok: false, reason: MOD_OFF });
    return;
  }

  const run = chatRunRegistry.getRun(sessionId);
  const stopTaskFn = run ? dependencies.stopTaskFns?.[run.provider] : undefined;
  if (!run || run.status !== 'running' || !run.providerSessionId) {
    reply({ ok: false, reason: 'turn_ended' });
    return;
  }
  if (!stopTaskFn) {
    reply({ ok: false, reason: 'unsupported' });
    return;
  }

  try {
    reply(await stopTaskFn(run.providerSessionId, taskId));
  } catch (error) {
    console.error('[Chat] Stopping a background task failed', {
      sessionId,
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    reply({ ok: false, reason: 'failed' });
  }
}

/**
 * Handles `chat.subscribe`: for each requested session, reports whether a run
 * is processing, re-attaches the live stream to this socket, replays missed
 * events (seq > lastSeq), and includes pending permission requests.
 *
 * This single message replaces the old `check-session-status`,
 * `get-pending-permissions`, and Claude-only writer reconnect flows.
 */
function handleChatSubscribe(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
  userId: string | number | null = null,
): void {
  const targets = Array.isArray(data.sessions) ? data.sessions : [];

  for (const target of targets) {
    if (!target || typeof target !== 'object') {
      continue;
    }

    const sessionId = typeof (target as AnyRecord).sessionId === 'string'
      ? ((target as AnyRecord).sessionId as string).trim()
      : '';
    if (!sessionId) {
      continue;
    }

    if (!canAccessSession(clientIdentities.get(ws), sessionId)) {
      sendProtocolError(ws, 'PROJECT_ACCESS_DENIED', 'You do not have access to this project.', sessionId);
      continue;
    }

    const lastSeqRaw = (target as AnyRecord).lastSeq;
    const lastSeq = typeof lastSeqRaw === 'number' && Number.isFinite(lastSeqRaw)
      ? Math.max(0, Math.floor(lastSeqRaw))
      : 0;

    const run = chatRunRegistry.getRun(sessionId);
    const isProcessing = chatRunRegistry.isProcessing(sessionId);
    logChatEvent('subscribe', { sessionId, userId, processing: isProcessing, lastSeq });

    // Future live events for this run should land on the socket that asked —
    // this is what makes mid-stream page refreshes work for all providers.
    if (isProcessing) {
      chatRunRegistry.attachConnection(sessionId, ws);
    }

    // Pending approvals are tracked under the provider-native id inside the
    // Claude runtime; remap their sessionId so the client only sees app ids.
    // Grok questions live in Neo3 after the CLI has already exited, keyed by
    // the app session id — include them even when no run is in flight.
    const pendingPermissions = [
      ...(run?.providerSessionId
        ? dependencies.getPendingApprovalsForSession(run.providerSessionId)
        : []
      ).map((approval) =>
        approval && typeof approval === 'object'
          ? { ...(approval as AnyRecord), sessionId }
          : approval,
      ),
      ...listGrokQuestionsForAppSession(sessionId).map((pending) => ({
        requestId: pending.requestId,
        toolName: 'AskUserQuestion',
        input: pending.input,
        sessionId,
        provider: 'grok',
      })),
    ];

    sendJson(ws, {
      kind: 'chat_subscribed',
      sessionId,
      isProcessing,
      lastSeq: run?.lastSeq ?? 0,
      pendingPermissions,
      timestamp: new Date().toISOString(),
    });

    // Replay only for RUNNING runs, strictly after the ack. Completed runs
    // are fully persisted to the provider transcript and served over REST —
    // replaying them (e.g. after a page reload where the client's lastSeq is
    // 0) would duplicate messages the history fetch already returned.
    if (isProcessing) {
      for (const event of chatRunRegistry.replayEvents(sessionId, lastSeq)) {
        sendJson(ws, event);
      }

      // «Фон: N» after a reload or a session switch: the live list now, not
      // only whatever changes after this moment.
      const listBackgroundTasks = run?.providerSessionId ? dependencies.backgroundTasksFns?.[run.provider] : undefined;
      if (run?.providerSessionId && listBackgroundTasks && backgroundConsoleOn(userId, dependencies.isModOn)) {
        sendJson(ws, {
          kind: 'background_tasks',
          sessionId,
          provider: run.provider,
          stoppable: Boolean(dependencies.stopTaskFns?.[run.provider]),
          tasks: listBackgroundTasks(run.providerSessionId),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

/**
 * Stands in for a websocket when an answer arrives from a push or Telegram:
 * nobody is watching live, so the resumed run's events are only buffered in
 * the run registry (replayed by `chat.subscribe` when the session is opened,
 * which swaps in the real socket) and fed to the session status. A fresh
 * object per run: nothing is shared between runs, nothing is registered
 * anywhere, and it is dropped with the run.
 */
function createDetachedConnection(): RealtimeClientConnection {
  return {
    readyState: 3, // CLOSED: the writer buffers, never sends
    send: () => {},
  };
}

/** Explicit UI approval starts one ordinary run; it never widens permissions. */
export function createIdeaRunControl(dependencies: ChatWebSocketDependencies): IdeaRunControl {
  return {
    start({ sessionId, userId, content }) {
      if (!isAdminUser({ id: userId }) || !canAccessSession({ id: userId }, sessionId)
        || !(dependencies.isModOn ?? isModOn)(userId, 'modImprovementIdeas')) return false;
      // A turn is going. A held run between turns is not one: the gateway
      // hands the idea to its live process.
      if (chatRunRegistry.runPhase(sessionId) === 'running') return false;
      const session = sessionsDb.getSessionById(sessionId);
      if (!session) return false;
      const previous = lastRunOptions(sessionId);
      const options = previous ?? { model: session.model, effort: session.effort, permissionMode: 'default' };
      if (options.permissionMode === 'plan') throw new IdeaError(409, 'В чате включено только планирование. Выбери режим выполнения и отправь сообщение, затем повтори.');
      const result = beginChatSend(createDetachedConnection(), userId, 'admin',
        { sessionId, content, options }, dependencies, { kind: 'idea', userId });
      if (result.started) void result.finished.catch(() => console.warn('[ImprovementIdeas] Run failed; see chat'));
      return result.started;
    },
  };
}

/**
 * The chat gateway's side of agent threads: a thread run (and the
 * «Треды готовы» message to its parent) is an ordinary run — registry,
 * indicator, Stop, «Ждут тебя» — started without a socket on behalf of the
 * parent's user (`thread` access). Nobody watches live; opening the chat
 * subscribes and replays the buffered events.
 */
export function createThreadRunControl(dependencies: ChatWebSocketDependencies): ThreadRunControl {
  return {
    start({ sessionId, userId, parentSessionId, content, options }) {
      const start = beginChatSend(
        createDetachedConnection(),
        userId,
        null,
        { sessionId, content, options },
        dependencies,
        { kind: 'thread', userId, parentSessionId },
      );
      if (start.started) {
        void start.finished.catch((error: unknown) => {
          console.error('[Chat] Thread run failed', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      return start.started;
    },
    abort(sessionId, actorUserId) {
      return abortSessionRun(sessionId, dependencies, actorUserId);
    },
  };
}

/**
 * The chat gateway's side of «Агенты»: the first message of a chat with an
 * agent (hidden role + task) is an ordinary run — registry, indicator, Stop,
 * «Ждут тебя» — started without a socket for the admin who pressed the
 * button (`agent` access). «Агенты» switched off → nothing starts.
 */
export function createAgentRunControl(dependencies: ChatWebSocketDependencies): AgentRunControl {
  return {
    start({ sessionId, userId, content, options }) {
      if (!(dependencies.isModOn ?? isModOn)(userId, 'modAgents')) return false;
      const start = beginChatSend(
        createDetachedConnection(),
        userId,
        null,
        { sessionId, content, options },
        dependencies,
        { kind: 'agent', userId },
      );
      if (start.started) {
        void start.finished.catch((error: unknown) => {
          console.error('[Chat] Agent run failed', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      return start.started;
    },
  };
}

/**
 * The chat gateway's side of the auto-relay: the handoff request and the
 * continuation's first message are ordinary runs — registry, indicator,
 * Stop, «Ждут тебя» — started without a socket for the chat's user
 * (`auto-relay` access). Opening the chat replays the buffered events.
 */
export function createAutoRelayRunControl(dependencies: ChatWebSocketDependencies): AutoRelayRunControl {
  return {
    start({ sessionId, userId, parentSessionId, content, options }) {
      const start = beginChatSend(
        createDetachedConnection(),
        userId,
        null,
        { sessionId, content, options },
        dependencies,
        { kind: 'auto-relay', userId, parentSessionId },
      );
      if (start.started) {
        void start.finished.catch((error: unknown) => {
          console.error('[Chat] Auto-relay run failed', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      return start.started;
    },
    backgroundTaskCount(sessionId) {
      const session = sessionsDb.getSessionById(sessionId);
      const providerSessionId = session?.provider_session_id;
      const lookup = session ? dependencies.backgroundTasksFns?.[session.provider as LLMProvider] : undefined;
      if (!providerSessionId || !lookup) {
        return 0;
      }
      try {
        const tasks = lookup(providerSessionId);
        return Array.isArray(tasks) ? tasks.length : 0;
      } catch {
        // Unknown = none: the fan-out of the run itself is gone with its process.
        return 0;
      }
    },
  };
}

/** What the queue shows in its card when the gateway refused to start the run. */
const QUEUED_SEND_REFUSALS: Record<string, string> = {
  SESSION_NOT_FOUND: 'Чат не найден',
  PROJECT_ACCESS_DENIED: 'Нет доступа к проекту этого чата',
  UNSUPPORTED_PROVIDER: 'Движок этого чата сейчас недоступен',
  RUN_IN_PROGRESS: 'В чате уже идёт ход',
};

/** Why the queue did not start a run past the 5-hour guard, for the queue card (its button is «Отправить»). */
function queuedLimitNotice(guard: UsageGuardState): string {
  const used = guard.pct === null ? `≥${guard.threshold}` : String(Math.round(guard.pct));
  return `Использовано ${used}% 5-часового лимита подписки Claude (порог ${guard.threshold}%) — новые прогоны придержаны, окно сбросится в ${formatResetMoscow(guard.resetsAt)}. Нажми «Отправить», чтобы запустить всё равно.`;
}

/**
 * The connection that followed the chat's last run, when it is a live socket
 * whose user may still open the chat. Anything else (a detached run, a closed
 * tab, a user whose access was taken away) is not carried over.
 */
function watcherOfLastRun(sessionId: string): RealtimeClientConnection | null {
  const connection = chatRunRegistry.getRun(sessionId)?.writer.ws;
  if (!connection || connection.readyState !== WS_OPEN_STATE || !connectedClients.has(connection)) {
    return null;
  }
  return canAccessSession(clientIdentities.get(connection), sessionId) ? connection : null;
}

/**
 * The chat gateway's side of the message queue (queued-messages): a queued
 * message is an ordinary run — registry, indicator, Stop, «Ждут тебя»,
 * «Новые / Недавние», the teammate jail — started without a socket for the
 * user who queued it (`queue` access, their rights at this moment). Nobody
 * has to be watching: the events are buffered and replayed on subscribe.
 */
export function createQueuedSendControl(dependencies: ChatWebSocketDependencies): QueuedSendControl {
  return {
    send({ sessionId, userId, content, options, images, echoed }) {
      if (userId === null) {
        return { started: false, busy: false, error: 'Неизвестно, кто поставил сообщение в очередь' };
      }
      const start = beginChatSend(
        createDetachedConnection(),
        userId,
        // Same source as the access rule: the role is read from the database.
        isAdminUser({ id: userId }) ? 'admin' : null,
        { sessionId, content, options: images.length > 0 ? { ...options, images } : options },
        dependencies,
        { kind: 'queue', userId, watcher: watcherOfLastRun(sessionId), echoed: echoed === true },
      );
      if (!start.started) {
        return {
          started: false,
          busy: start.code === 'RUN_IN_PROGRESS',
          // Jail refusals are already written for a person.
          error: QUEUED_SEND_REFUSALS[start.code] ?? start.error,
        };
      }
      void start.finished.catch((error: unknown) => {
        console.error('[Chat] Queued run failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return { started: true };
    },
    isRunLive(sessionId) {
      // A held run between turns takes a message at once: no turn is going.
      return chatRunRegistry.runPhase(sessionId) === 'running';
    },
    runPhase(sessionId) {
      return chatRunRegistry.runPhase(sessionId);
    },
    abortRun(sessionId, userId) {
      return abortSessionRun(sessionId, dependencies, userId);
    },
    lastRunStopped(sessionId) {
      const run = chatRunRegistry.getRun(sessionId);
      if (!run || run.status !== 'completed') {
        return false;
      }
      const last = run.events[run.events.length - 1];
      return last?.kind === 'complete' && last.aborted === true;
    },
    async sendLimit({ sessionId, options }) {
      // Only a new run is guarded: a live process is not asked by the runtime
      // either, and a message the user already confirmed is not asked twice.
      if (options.usageGuardOverride === true || chatRunRegistry.runPhase(sessionId) !== null) {
        return null;
      }
      const provider = sessionsDb.getSessionById(sessionId)?.provider as LLMProvider | undefined;
      const guard = provider ? dependencies.usageGuardFns?.[provider] : undefined;
      if (!guard) {
        return null;
      }
      const state = await guard();
      return state.blocked ? queuedLimitNotice(state) : null;
    },
  };
}

/** App session id behind a provider-native (or already app) session id. */
function appSessionIdOf(sessionId: string | null): string | null {
  if (!sessionId) {
    return null;
  }
  return sessionsDb.getSessionByProviderSessionId(sessionId)?.session_id
    ?? sessionsDb.getSessionById(sessionId)?.session_id
    ?? null;
}

/** Original AskUserQuestion input of a paused Claude approval (answers get merged into it). */
function findClaudeApprovalInput(
  requestId: string,
  appSessionId: string | null,
  dependencies: ChatWebSocketDependencies,
): Record<string, unknown> | null {
  const asRecord = (value: unknown) => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  );
  const direct = asRecord(dependencies.getPendingApprovalById?.(requestId)?.input);
  if (direct) {
    return direct;
  }
  if (!appSessionId) {
    return null;
  }
  const providerSessionId = chatRunRegistry.getRun(appSessionId)?.providerSessionId
    ?? sessionsDb.getSessionById(appSessionId)?.provider_session_id
    ?? null;
  if (!providerSessionId) {
    return null;
  }
  const approval = dependencies.getPendingApprovalsForSession(providerSessionId)
    .find((entry) => entry && typeof entry === 'object' && (entry as AnyRecord).requestId === requestId) as AnyRecord | undefined;
  return asRecord(approval?.input);
}

/**
 * Engines' side of `pending-answers`, one decision whichever channel it came
 * from. Claude pauses the SDK on the request, so the decision resolves it;
 * Grok has already exited, so the answer becomes the next user turn via
 * `--resume` (same path as a panel click). With no connection the resumed
 * run streams into the registry only. A Grok request whose resumed turn did
 * not start goes back to its store — the question stays open.
 */
export function createPermissionAnswerEngine(dependencies: ChatWebSocketDependencies): AnswerEngine {
  const locate = (requestId: string): PendingRequestInfo | null => {
    const grokQuestion = peekGrokQuestion(requestId);
    if (grokQuestion) {
      return { requestId, sessionId: grokQuestion.appSessionId, provider: 'grok', reason: 'ask' };
    }
    const grokPlan = peekGrokPlanExit(requestId);
    if (grokPlan) {
      return { requestId, sessionId: grokPlan.appSessionId, provider: 'grok', reason: 'plan' };
    }
    const approval = dependencies.getPendingApprovalById?.(requestId);
    if (approval) {
      return { requestId, sessionId: appSessionIdOf(approval.sessionId), provider: 'claude', reason: null };
    }
    return null;
  };

  const startResumedRun = (
    connection: RealtimeClientConnection | null,
    actor: { id: number | null; role: string | null },
    data: AnyRecord,
  ): boolean => {
    // A panel answer arrives over a socket and is checked like any chat.send;
    // only a push/Telegram answer (no connection) continues detached, with the
    // actor already verified by pendingAnswers.
    const target = connection ?? createDetachedConnection();
    const access: ChatSendAccess = connection ? { kind: 'socket' } : { kind: 'verified-answer' };
    let start: ChatSendStart;
    try {
      start = beginChatSend(target, actor.id, actor.role, data, dependencies, access);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Chat] Resumed run failed to start', { sessionId: data.sessionId, error: message });
      return false;
    }
    if (start.started) {
      void start.finished.catch((error: unknown) => {
        console.error('[Chat] Resumed run failed', {
          sessionId: data.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return start.started;
  };

  const deliver: AnswerDeliverer = async ({ requestId, decision, actor, connection, request }) => {
    const grokPending = takeGrokQuestion(requestId);
    if (grokPending) {
      const updatedInput = decision.updatedInput
        ?? (decision.answers ? { ...grokPending.input, answers: decision.answers } : undefined);
      const answersText = decision.allow === false
        ? 'Skip'
        : serializeGrokQuestionAnswers(updatedInput, grokPending.input);
      // Before the start: the resumed CLI reads its transcript when it spawns.
      rewriteGrokHeadlessQuestionStub({
        workingDir: grokPending.resumeOptions?.cwd ?? grokPending.resumeOptions?.projectPath,
        sessionUuid: grokPending.providerSessionId,
        answersText,
      });
      const started = startResumedRun(connection, actor, {
        sessionId: grokPending.appSessionId,
        content: answersText,
        options: grokPending.resumeOptions ?? {},
      });
      if (!started) {
        registerGrokQuestion(grokPending);
        return false;
      }
      return true;
    }

    const grokPlan = takeGrokPlanExit(requestId);
    if (grokPlan) {
      const approved = decision.allow !== false;
      const started = startResumedRun(connection, actor, {
        sessionId: grokPlan.appSessionId,
        content: approved
          ? 'The plan is approved. Carry it out to the end in this turn. Do not ask for another OK. Close with: the project is done, the user should check it.'
          : (typeof decision.message === 'string' && decision.message.trim()
            ? decision.message
            : 'Revise the plan.'),
        options: {
          ...(grokPlan.resumeOptions ?? {}),
          permissionMode: approved ? 'bypassPermissions' : 'plan',
        },
      });
      if (!started) {
        registerGrokPlanExit(grokPlan);
        return false;
      }
      return true;
    }

    let updatedInput = decision.updatedInput;
    if (updatedInput === undefined && decision.answers) {
      // Answers without the original questions would hand the CLI a broken
      // AskUserQuestion input — better not to deliver at all.
      const original = findClaudeApprovalInput(requestId, request.sessionId, dependencies);
      if (!original) {
        return false;
      }
      updatedInput = { ...original, answers: decision.answers };
    }
    dependencies.resolveToolApproval(requestId, {
      allow: Boolean(decision.allow),
      updatedInput,
      message: typeof decision.message === 'string' ? decision.message : undefined,
      rememberEntry: decision.rememberEntry,
    });
    return true;
  };

  return { locate, deliver };
}

const PERMISSION_FAILURES: Record<AnswerReason, { code: string; error: string }> = {
  not_pending: { code: 'PERMISSION_REQUEST_NOT_FOUND', error: 'This request is no longer waiting for an answer.' },
  forbidden: { code: 'PERMISSION_ACCESS_DENIED', error: 'You do not have access to this session.' },
  unavailable: { code: 'PERMISSION_DELIVERY_FAILED', error: 'The answer could not be delivered; the request is still open.' },
  in_progress: { code: 'PERMISSION_ANSWER_IN_PROGRESS', error: 'This request is already being answered.' },
};

/**
 * Handles `chat.permission-response`: the chat panel's answer to an open
 * request. Goes through `pending-answers` like push and Telegram do, so the
 * same access rule applies — a session of a project the user was not granted
 * cannot be answered by guessing its request id. A refused answer is reported
 * back as a `protocol_error`, never dropped silently.
 */
async function handlePermissionResponse(
  ws: WebSocket,
  userId: string | number | null,
  userRole: string | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
): Promise<void> {
  if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
    return;
  }

  const result = await pendingAnswers.answer({
    requestId: data.requestId,
    decision: {
      allow: typeof data.allow === 'boolean' ? data.allow : undefined,
      updatedInput: data.updatedInput,
      message: typeof data.message === 'string' ? data.message : undefined,
      rememberEntry: data.rememberEntry,
    },
    actorUserId: userId,
    // No actorRole: pending-answers reads the role from the database, the
    // same source the project-access rule uses — a token role cannot elevate.
    via: 'ui',
    connection: ws,
    engine: createPermissionAnswerEngine(dependencies),
  });

  if (!result.ok) {
    const failure = PERMISSION_FAILURES[result.reason];
    sendJson(ws, {
      kind: 'protocol_error',
      code: failure.code,
      error: failure.error,
      requestId: data.requestId,
      sessionId: null,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Handles authenticated chat websocket messages used by the main chat panel.
 *
 * Inbound protocol (client to server):
 * - `chat.send`                { sessionId, content, options? }
 * - `chat.abort`               { sessionId }
 * - `chat.stop-task`           { sessionId, taskId } → `background_task_stop`
 * - `chat.subscribe`           { sessions: [{ sessionId, lastSeq? }] }
 * - `chat.permission-response` { requestId, allow, updatedInput?, message?, rememberEntry? }
 *
 * Outbound protocol (server to client): every frame is `kind`-based — either
 * a provider `NormalizedMessage` (with `seq`) or a gateway event
 * (`chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`).
 */
export function handleChatConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest,
  dependencies: ChatWebSocketDependencies
): void {
  console.log('[INFO] Chat WebSocket connected');
  clientIdentities.set(ws, request.user ?? {});
  connectedClients.add(ws);

  const userId = readRequestUserId(request);
  const userRole = readRequestUserRole(request);

  ws.on('message', async (rawMessage) => {
    try {
      const parsed = parseIncomingJsonObject(rawMessage);
      if (!parsed) {
        throw new Error('Invalid websocket payload');
      }

      const data = parsed as AnyRecord;
      const messageType = typeof data.type === 'string' ? data.type : '';

      switch (messageType) {
        case 'chat.send':
          await handleChatSend(ws, userId, userRole, data, dependencies);
          return;
        case 'chat.abort':
          if (!canAccessSession(request.user, String(data.sessionId ?? ''))) {
            sendProtocolError(ws, 'PROJECT_ACCESS_DENIED', 'You do not have access to this project.');
            return;
          }
          await handleChatAbort(ws, data, dependencies, userId);
          return;
        case 'chat.stop-task':
          if (!canAccessSession(request.user, String(data.sessionId ?? ''))) {
            sendProtocolError(ws, 'PROJECT_ACCESS_DENIED', 'You do not have access to this project.');
            return;
          }
          await handleChatStopTask(ws, data, dependencies, userId);
          return;
        case 'chat.subscribe':
          handleChatSubscribe(ws, data, dependencies, userId);
          return;
        case 'chat.permission-response':
          await handlePermissionResponse(ws, userId, userRole, data, dependencies);
          return;
        default:
          sendProtocolError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${messageType}".`);
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ERROR] Chat WebSocket error:', message);
      sendProtocolError(ws, 'INTERNAL_ERROR', message);
    }
  });

  ws.on('close', () => {
    console.log('[INFO] Chat client disconnected');
    connectedClients.delete(ws);
  });
}

import path from 'node:path';

import type { WebSocket } from 'ws';

import { projectsDb, sessionsDb, userProjectAccessDb } from '@/modules/database/index.js';
import { newRunId, recordAuditEvent, RunMeter } from '@/modules/governance/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
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
  rewriteGrokHeadlessQuestionStub,
  serializeGrokQuestionAnswers,
  takeGrokPlanExit,
  takeGrokQuestion,
  takeGrokQuestionsForAppSession,
} from '@/shared/grok-question.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  LLMProvider,
} from '@/shared/types.js';
import { createNormalizedMessage, parseIncomingJsonObject } from '@/shared/utils.js';

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

type ChatWebSocketDependencies = {
  /** Provider runtimes keyed by provider id. */
  spawnFns: Record<LLMProvider, ProviderSpawnFn>;
  /**
   * Abort functions keyed by provider id. They are addressed with the
   * provider-native session id (that is how runtimes key their process maps).
   * The Claude abort is async; the rest are sync — both shapes are accepted.
   */
  abortFns: Record<LLMProvider, (providerSessionId: string) => boolean | Promise<boolean>>;
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
};

/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
function readRequestUserId(
  request: AuthenticatedWebSocketRequest | undefined
): string | number | null {
  const user = request?.user;
  if (!user) {
    return null;
  }

  if (typeof user.id === 'string' || typeof user.id === 'number') {
    return user.id;
  }

  if (typeof user.userId === 'string' || typeof user.userId === 'number') {
    return user.userId;
  }

  return null;
}

/** Reads the authenticated request user's role, if present (added alongside userId/username). */
function readRequestUserRole(request: AuthenticatedWebSocketRequest | undefined): string | null {
  const role = request?.user?.role;
  return typeof role === 'string' ? role : null;
}

function sendJson(ws: WebSocket, payload: unknown): void {
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
  ws: WebSocket,
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
 * Handles `chat.send`: resolves the session row (provider, project path, and
 * provider-native id all come from the database — never from the client),
 * registers the run, and dispatches to the provider runtime.
 */
async function handleChatSend(
  ws: WebSocket,
  userId: string | number | null,
  userRole: string | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.send requires a sessionId.');
    return;
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    sendProtocolError(
      ws,
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`,
      sessionId
    );
    return;
  }

  // Non-admin employees may only open sessions for projects an admin granted
  // them via the admin panel — listing already filters the sidebar, but a
  // known/guessed sessionId must not bypass that (see user_project_access).
  if (userRole && userRole !== 'admin' && userId !== null && session.project_path) {
    const projectRow = projectsDb.getProjectPath(session.project_path);
    const accessibleProjectIds = userProjectAccessDb.getAccessibleProjectIds(Number(userId));
    if (!projectRow || !accessibleProjectIds.includes(projectRow.project_id)) {
      sendProtocolError(
        ws,
        'PROJECT_ACCESS_DENIED',
        'You do not have access to this project.',
        sessionId
      );
      return;
    }
  }

  const provider = session.provider as LLMProvider;
  const spawnFn = dependencies.spawnFns[provider];
  if (!spawnFn) {
    sendProtocolError(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return;
  }

  // Typing an answer while Grok's synthetic question panel is up is the
  // supported fallback ("2" as text). Drop the panel so a later click does
  // not start a second resume.
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

  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider,
    providerSessionId: session.provider_session_id,
    connection: ws,
    userId,
  });

  if (!run) {
    sendProtocolError(
      ws,
      'RUN_IN_PROGRESS',
      `Session "${sessionId}" already has a run in progress.`,
      sessionId
    );
    return;
  }

  const clientOptions = (data.options ?? {}) as AnyRecord;
  const rawContent = typeof data.content === 'string' ? data.content : '';

  // Client attachments are re-validated to the upload store, then split: images
  // ride along as vision blocks (per provider), while other files are referenced
  // by path in an <attached_files> block the agent reads with its own tools.
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
    cwd: clientOptions.cwd ?? session.project_path ?? undefined,
    projectPath: session.project_path ?? clientOptions.projectPath,
  };

  // One run, one audit trail. The meter rides along in the runtime options and
  // is fed by the engine as usage arrives. Claude and Grok report real usage;
  // other engines still record the run with token counts of zero rather than
  // an invented price.
  const runId = newRunId();
  const meter = new RunMeter();
  const startedAt = Date.now();
  runtimeOptions.meter = meter;

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
}

/**
 * Handles `chat.abort`: cancels the run for one app session and emits the
 * terminal `complete` on its behalf (runtimes skip their own complete for
 * aborted runs, and the registry drops any duplicate).
 */
async function handleChatAbort(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.abort requires a sessionId.');
    return;
  }

  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') {
    sendProtocolError(ws, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`, sessionId);
    return;
  }

  const abortFn = dependencies.abortFns[run.provider];

  // Complete FIRST, kill second. Marking the run finished fences its event
  // stream (the registry drops everything a still-winding-down runtime emits),
  // so no output can land in the chat after the user pressed Stop — and the
  // UI gets its answer immediately instead of waiting out the interrupt RPC.
  chatRunRegistry.completeRun(sessionId, { exitCode: 0, aborted: true });

  if (!abortFn) {
    return;
  }

  if (run.providerSessionId) {
    await abortFn(run.providerSessionId);
    return;
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
  dependencies: ChatWebSocketDependencies
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

    const lastSeqRaw = (target as AnyRecord).lastSeq;
    const lastSeq = typeof lastSeqRaw === 'number' && Number.isFinite(lastSeqRaw)
      ? Math.max(0, Math.floor(lastSeqRaw))
      : 0;

    const run = chatRunRegistry.getRun(sessionId);
    const isProcessing = chatRunRegistry.isProcessing(sessionId);

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
    }
  }
}

/**
 * Handles `chat.permission-response`: forwards a tool-approval decision to the
 * pending approval resolver. Claude pauses the SDK for this; Grok has already
 * exited, so a panel click becomes the next user turn via `--resume`.
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

  const grokPending = takeGrokQuestion(data.requestId);
  if (grokPending) {
    const answersText = data.allow === false
      ? 'Skip'
      : serializeGrokQuestionAnswers(data.updatedInput, grokPending.input);
    rewriteGrokHeadlessQuestionStub({
      workingDir: grokPending.resumeOptions?.cwd ?? grokPending.resumeOptions?.projectPath,
      sessionUuid: grokPending.providerSessionId,
      answersText,
    });
    await handleChatSend(ws, userId, userRole, {
      sessionId: grokPending.appSessionId,
      content: answersText,
      options: grokPending.resumeOptions ?? {},
    }, dependencies);
    return;
  }

  const grokPlan = takeGrokPlanExit(data.requestId);
  if (grokPlan) {
    const approved = data.allow !== false;
    await handleChatSend(ws, userId, userRole, {
      sessionId: grokPlan.appSessionId,
      content: approved
        ? 'The plan is approved. Carry it out to the end in this turn. Do not ask for another OK. Close with: the project is done, the user should check it.'
        : (typeof data.message === 'string' && data.message.trim()
          ? data.message
          : 'Revise the plan.'),
      options: {
        ...(grokPlan.resumeOptions ?? {}),
        permissionMode: approved ? 'bypassPermissions' : 'plan',
      },
    }, dependencies);
    return;
  }

  dependencies.resolveToolApproval(data.requestId, {
    allow: Boolean(data.allow),
    updatedInput: data.updatedInput,
    message: typeof data.message === 'string' ? data.message : undefined,
    rememberEntry: data.rememberEntry,
  });
}

/**
 * Handles authenticated chat websocket messages used by the main chat panel.
 *
 * Inbound protocol (client to server):
 * - `chat.send`                { sessionId, content, options? }
 * - `chat.abort`               { sessionId }
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
          await handleChatAbort(ws, data, dependencies);
          return;
        case 'chat.subscribe':
          handleChatSubscribe(ws, data, dependencies);
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

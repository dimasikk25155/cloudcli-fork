/**
 * Side chat («Побочный чат», `/btw`, «Спросить в стороне»): a question asked
 * on the side of a chat without disturbing it.
 *
 *   POST /api/sessions/:id/btw {question, quote?, provider?, model?}
 *     → a new chat in the same project, linked to the parent as `btw`, on the
 *       parent's engine / model / effort (unless the request names others),
 *       started with the question + the hidden `<btw_context>` block.
 *
 * The parent is never touched: its run (if any) goes on, nothing is written
 * into it. The child is created the way every linked chat is
 * (assertCanLinkNewChild → createAppSession → linkSession) and its first
 * message goes through the chat gateway like the auto-relay continuation's
 * (registry, indicator, Stop, «Ждут тебя»), so it works with no tab open.
 */

import { sessionsDb } from '@/modules/database/index.js';
import { assertCanLinkNewChild, linkSession } from '@/modules/session-links/session-links.service.js';
import { isModOn as defaultIsModOn, modOffError, type IsModOn } from '@/shared/mods.js';
import type { ProjectAccessUser } from '@/shared/project-access.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import type { ReplyTurnMessage } from '../../../shared/reply-turn.js';

import { buildBtwFirstMessage, lastAssistantText } from './btw-message.js';

/** One run the side chat asks the chat gateway to start (the auto-relay run-control shape). */
export type BtwRunStart = {
  sessionId: string;
  userId: number;
  /** The chat the gateway checks the link against; for a side chat — the child itself. */
  parentSessionId: string;
  content: string;
  options: Record<string, unknown>;
};

export type BtwRunControl = {
  /** True when the run was registered and started. */
  start(input: BtwRunStart): boolean;
};

export type BtwStartInput = {
  parentSessionId: string;
  user: ProjectAccessUser;
  question: unknown;
  quote?: unknown;
  /** Another engine for the side chat; by default the parent's. */
  provider?: unknown;
  model?: unknown;
};

export type BtwStartResult = {
  sessionId: string;
  parentSessionId: string;
  relation: 'btw';
  provider: string;
  model: string | null;
  effort: string | null;
  /** Mode of the first run; follow-ups from the side-chat tab repeat it. */
  permissionMode: string | null;
  title: string;
};

export type BtwDependencies = {
  isModOn?: IsModOn;
  /** Parent transcript (normalized), newest last. */
  fetchMessages?: (sessionId: string) => Promise<ReplyTurnMessage[]>;
  /** The parent's last typed run options (model, effort, mode, tools). */
  lastRunOptions?: (sessionId: string) => Record<string, unknown> | null;
  /** Creates the app session row; returns its id. */
  createSession?: (provider: LLMProvider, projectPath: string) => string;
  /** Re-sends a sidebar card (the child appears, the parent gains a child). */
  broadcastUpsert?: (sessionId: string) => void;
  runControl?: BtwRunControl;
};

/** Engines a side chat may be switched to (the selectable ones). */
const SIDE_PROVIDERS = new Set(['claude', 'codex', 'grok']);
const QUESTION_MAX = 8000;
const QUOTE_MAX = 4000;
const TITLE_MAX = 60;

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function refuse(message: string, code: string, statusCode: number): never {
  throw new AppError(message, { code, statusCode });
}

async function defaultFetchMessages(sessionId: string): Promise<ReplyTurnMessage[]> {
  const { sessionsService } = await import('@/modules/providers/index.js');
  const history = await sessionsService.fetchHistory(sessionId, { limit: 60, offset: 0 });
  return history.messages as ReplyTurnMessage[];
}

function defaultCreateSession(provider: LLMProvider, projectPath: string): Promise<string> {
  return import('@/modules/providers/index.js')
    .then(({ sessionsService }) => sessionsService.createAppSession(provider, projectPath).sessionId);
}

function defaultLastRunOptions(sessionId: string): Promise<Record<string, unknown> | null> {
  return import('@/modules/auto-relay/index.js').then(({ lastRunOptions }) => lastRunOptions(sessionId));
}

function defaultBroadcastUpsert(sessionId: string): void {
  void import('@/modules/websocket/index.js')
    .then(({ chatRunRegistry }) => chatRunRegistry.broadcastSessionUpsert(sessionId))
    .catch(() => {});
}

function userIdOf(user: ProjectAccessUser): number | null {
  const raw = (user as { id?: unknown; userId?: unknown } | null | undefined);
  const id = Number(raw?.id ?? raw?.userId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The parent's engine options for the child: its last typed run, else its
 * stored model/effort. Plan modes are dropped — the side run has nobody to
 * answer a plan prompt (same rule as the auto-relay's automatic turns).
 */
function inheritedOptions(
  provider: string,
  stored: { model: string | null; effort: string | null },
  last: Record<string, unknown> | null,
): Record<string, unknown> {
  const options: Record<string, unknown> = { ...(last ?? {}) };
  if (!options.model && stored.model) options.model = stored.model;
  if (!options.effort && stored.effort) options.effort = stored.effort;
  if (options.permissionMode === 'plan') delete options.permissionMode;
  if (options.permissionMode === 'planBypass' && provider !== 'codex') delete options.permissionMode;
  return options;
}

export function createBtwService(dependencies: BtwDependencies = {}) {
  const isModOn = dependencies.isModOn ?? defaultIsModOn;
  const fetchMessages = dependencies.fetchMessages ?? defaultFetchMessages;
  const readLastRunOptions = dependencies.lastRunOptions
    ? async (sessionId: string) => dependencies.lastRunOptions!(sessionId)
    : defaultLastRunOptions;
  const createSession = dependencies.createSession
    ? async (provider: LLMProvider, projectPath: string) => dependencies.createSession!(provider, projectPath)
    : defaultCreateSession;
  const broadcastUpsert = dependencies.broadcastUpsert ?? defaultBroadcastUpsert;
  let runControl: BtwRunControl | null = dependencies.runControl ?? null;

  async function start(input: BtwStartInput): Promise<BtwStartResult> {
    const userId = userIdOf(input.user);
    if (!isModOn(userId, 'modSideChat')) throw modOffError('modSideChat');

    const question = typeof input.question === 'string' ? input.question.trim() : '';
    if (!question) refuse('Напиши вопрос для побочного чата', 'BTW_QUESTION_REQUIRED', 400);
    if (question.length > QUESTION_MAX) refuse('Вопрос слишком длинный', 'BTW_QUESTION_TOO_LONG', 400);
    const quote = typeof input.quote === 'string' ? input.quote.trim().slice(0, QUOTE_MAX) : '';

    const parentSessionId = input.parentSessionId;
    const parent = sessionsDb.getSessionById(parentSessionId);
    if (!parent) refuse('Чат не найден', 'SESSION_NOT_FOUND', 404);
    if (!parent!.project_path) refuse('У чата нет папки проекта', 'BTW_NO_PROJECT', 400);
    // Relation, access to the parent, same project — before anything is written.
    assertCanLinkNewChild({ parentSessionId, relation: 'btw', projectPath: parent!.project_path!, user: input.user });
    if (userId === null) refuse('Нет доступа к чату', 'SESSION_ACCESS_DENIED', 403);

    const control = runControl;
    if (!control) refuse('Побочный чат сейчас недоступен — сервер ещё запускается', 'BTW_UNAVAILABLE', 503);

    const requestedProvider = typeof input.provider === 'string' && SIDE_PROVIDERS.has(input.provider)
      ? input.provider
      : parent!.provider;
    const requestedModel = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : null;
    const options = requestedProvider === parent!.provider
      ? inheritedOptions(requestedProvider, { model: parent!.model ?? null, effort: parent!.effort ?? null }, await readLastRunOptions(parentSessionId))
      : {};
    if (requestedModel) options.model = requestedModel;

    let lastReply: string | null = null;
    try {
      lastReply = lastAssistantText(await fetchMessages(parentSessionId));
    } catch {
      // Best effort: the question and the quote still go.
    }
    const content = buildBtwFirstMessage({ question, quote, lastReply });

    const childId = await createSession(requestedProvider as LLMProvider, parent!.project_path!);
    const model = typeof options.model === 'string' ? options.model : null;
    const effort = typeof options.effort === 'string' ? options.effort : null;
    const permissionMode = typeof options.permissionMode === 'string' ? options.permissionMode : null;
    const title = clip(`Побочный: ${question}`, TITLE_MAX);
    try {
      linkSession({ childSessionId: childId, parentSessionId, relation: 'btw', user: input.user });
      sessionsDb.updateSessionCustomName(childId, title);
      if (model) sessionsDb.updateSessionModel(childId, model);
      if (effort) sessionsDb.updateSessionEffort(childId, effort);
    } catch (error) {
      sessionsDb.deleteSessionById(childId);
      throw error;
    }

    // The gateway's linked-run rule lets a chat's own run through
    // (`parentSessionId` = the target); the child's user and project were
    // checked above, and the gateway checks access to the child again.
    const started = control!.start({ sessionId: childId, userId: userId!, parentSessionId: childId, content, options });
    if (!started) {
      sessionsDb.deleteSessionById(childId);
      refuse('Побочный чат не запустился — попробуй ещё раз', 'BTW_NOT_STARTED', 409);
    }

    broadcastUpsert(childId);
    broadcastUpsert(parentSessionId);
    return { sessionId: childId, parentSessionId, relation: 'btw', provider: requestedProvider, model, effort, permissionMode, title };
  }

  return {
    start,
    /** Wired once at boot with the chat gateway's run control (`createAutoRelayRunControl`). */
    setRunControl(control: BtwRunControl): void {
      runControl = control;
    },
  };
}

export type BtwService = ReturnType<typeof createBtwService>;

export const btwService: BtwService = createBtwService();

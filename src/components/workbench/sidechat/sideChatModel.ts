/**
 * Side chat (`btw`) and second chat (`chat`) tabs of the canvas: the rules the
 * pane follows, kept out of React so they are tested on their own.
 *
 * Both kinds show one chat (`tab.ref` = its session id) in the same
 * ChatInterface as the main chat (prop `embedded`).
 */
import type { LLMProvider, ProjectSession } from '../../../types/app';
import { stripAgentOnlyBlocks } from '../../../../shared/agent-only-blocks';

/** Engine a side chat was created with (from the `/btw` answer). */
export type SideChatEngine = {
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
  permissionMode?: string | null;
};

/** The canvas tab of a side chat: one per child, opened on the parent's canvas. */
export function sideChatTabFor(child: { sessionId: string; title: string }): { kind: 'btw'; ref: string; title: string } {
  return { kind: 'btw', ref: child.sessionId, title: child.title };
}

type PaneSessionSource = Pick<ProjectSession, 'id'> & Partial<ProjectSession>;

/**
 * The session the chat pane opens: the project's own record when the list has
 * it, otherwise one built from the id, the engine and the project — a fresh
 * `/btw` chat reaches the list only with the next `session_upserted`, and
 * without a session the first send would start yet another new chat.
 */
export function paneSession(
  sessions: PaneSessionSource[],
  sessionId: string,
  engine: SideChatEngine | null,
  project: { projectId: string },
  title: string,
): ProjectSession {
  const match = sessions.find((candidate) => String(candidate.id) === sessionId);
  const provider = (match?.__provider ?? match?.provider ?? engine?.provider ?? 'claude') as LLMProvider;
  if (match) {
    return { ...match, id: sessionId, __provider: provider, __projectId: match.__projectId ?? project.projectId };
  }
  return {
    id: sessionId,
    __provider: provider,
    __projectId: project.projectId,
    summary: title,
    ...(engine?.model ? { model: engine.model } : {}),
    ...(engine?.effort ? { effort: engine.effort } : {}),
  };
}

/** Fields of the session the chat reacts to; activity timestamps are not among them. */
const SESSION_VIEW_FIELDS = ['id', '__provider', '__projectId', 'summary', 'name', 'title', 'model', 'effort', 'createdAt', 'created_at'] as const;

/**
 * Same chat as far as the pane is concerned? The project list is rebuilt on
 * every sidebar event; handing ChatInterface a new object each time re-ran its
 * session effects (a fresh `chat.subscribe` per event).
 */
export function sameSessionView(a: ProjectSession, b: ProjectSession): boolean {
  return SESSION_VIEW_FIELDS.every((field) => a[field] === b[field])
    && JSON.stringify(a.links ?? null) === JSON.stringify(b.links ?? null);
}

type PickerSession = {
  id: string;
  name?: unknown;
  summary?: unknown;
  title?: unknown;
  lastActivity?: unknown;
  updated_at?: unknown;
};

export type ChatPickerChoice = { sessionId: string; title: string };

function sessionTitle(session: PickerSession): string {
  for (const value of [session.name, session.summary, session.title]) {
    if (typeof value === 'string' && value.trim()) return stripAgentOnlyBlocks(value).trim() || 'Новый чат';
  }
  return 'Новый чат';
}

function activityOf(session: PickerSession): number {
  const raw = typeof session.lastActivity === 'string' ? session.lastActivity : typeof session.updated_at === 'string' ? session.updated_at : '';
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : 0;
}

/** Chats of the project the second-chat tab can show: all but the canvas's own, newest first. */
export function chatPickerChoices(sessions: PickerSession[], canvasSessionId: string | null): ChatPickerChoice[] {
  return sessions
    .filter((session) => session.id && session.id !== canvasSessionId)
    .sort((a, b) => activityOf(b) - activityOf(a))
    .map((session) => ({ sessionId: session.id, title: sessionTitle(session) }));
}

/** Title of a chat tab whose chat the project list does not know yet. */
export const PENDING_CHAT_TITLE = 'Чат';
const PROVISIONAL_TITLES = new Set(['', PENDING_CHAT_TITLE, 'Новый чат']);

/** Title for a tab retargeted to `sessionId`: the list's, or the stand-in until it arrives. */
export function retargetTitle(sessions: PickerSession[], sessionId: string): string {
  return chatPickerChoices(sessions, null).find((choice) => choice.sessionId === sessionId)?.title ?? PENDING_CHAT_TITLE;
}

/**
 * The title a chat tab should switch to now, or null to keep it: a stand-in
 * title («Чат», «Новый чат») gives way to the chat's own name once the
 * project list has the chat with one.
 */
export function settledTabTitle(tabTitle: string, sessions: PickerSession[], sessionId: string): string | null {
  if (!PROVISIONAL_TITLES.has(tabTitle.trim())) return null;
  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session) return null;
  const title = sessionTitle(session);
  return PROVISIONAL_TITLES.has(title) || title === tabTitle ? null : title;
}

/**
 * Engine options of side chats, by session id — the chat list of the project
 * may not know a fresh `/btw` chat yet, so its engine comes from here.
 */
export function createSideChatStore() {
  const engines = new Map<string, SideChatEngine>();
  return {
    getEngine: (sessionId: string): SideChatEngine | null => engines.get(sessionId) ?? null,
    setEngine: (sessionId: string, engine: SideChatEngine): void => {
      engines.set(sessionId, engine);
    },
  };
}

export type SideChatStore = ReturnType<typeof createSideChatStore>;

export const sideChatStore: SideChatStore = createSideChatStore();

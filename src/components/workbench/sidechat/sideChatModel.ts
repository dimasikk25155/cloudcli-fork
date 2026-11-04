/**
 * Side chat (`btw`) and second chat (`chat`) tabs of the canvas: the rules the
 * pane follows, kept out of React so they are tested on their own.
 *
 * Both kinds show one chat (`tab.ref` = its session id) with its own feed,
 * input and status; whatever is typed there goes to that chat only.
 */
import { stripAgentOnlyBlocks } from '../../../../shared/agent-only-blocks';
import { isInjectedUserText } from '../../../../shared/reply-turn';

export type SideChatTabRef = { kind: string; ref?: string };

/** Engine options a follow-up repeats (the chat's own model/effort/mode). */
export type SideChatEngine = {
  model?: string | null;
  effort?: string | null;
  permissionMode?: string | null;
};

export type ChatSendFrame = {
  type: 'chat.send';
  sessionId: string;
  content: string;
  options: Record<string, unknown>;
};

/** `chat.send` for the chat of this tab — null when no chat is picked or nothing is typed. */
export function chatSendFrame(tab: SideChatTabRef, text: string, engine: SideChatEngine | null): ChatSendFrame | null {
  const sessionId = tab.ref?.trim();
  const content = text.trim();
  if (!sessionId || !content) return null;
  const options: Record<string, unknown> = { sessionSummary: content.slice(0, 120) };
  if (engine?.model) options.model = engine.model;
  if (engine?.effort) options.effort = engine.effort;
  if (engine?.permissionMode) options.permissionMode = engine.permissionMode;
  return { type: 'chat.send', sessionId, content, options };
}

/** The canvas tab of a side chat: one per child, opened on the parent's canvas. */
export function sideChatTabFor(child: { sessionId: string; title: string }): { kind: 'btw'; ref: string; title: string } {
  return { kind: 'btw', ref: child.sessionId, title: child.title };
}

export type SideChatRow = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
};

type FeedMessage = {
  id?: string;
  kind?: string;
  role?: string;
  content?: unknown;
  toolName?: string;
};

/** Transcript → the pane's rows: typed text (hidden blocks cut), answers, tool names, errors. */
export function feedRows(messages: FeedMessage[]): SideChatRow[] {
  const rows: SideChatRow[] = [];
  messages.forEach((message, index) => {
    const id = message.id || `row-${index}`;
    const content = typeof message.content === 'string' ? message.content : '';
    if (message.kind === 'text' && message.role === 'user') {
      if (isInjectedUserText(content)) return;
      const text = stripAgentOnlyBlocks(content);
      if (text) rows.push({ id, role: 'user', text });
    } else if (message.kind === 'text' && message.role === 'assistant') {
      if (content.trim()) rows.push({ id, role: 'assistant', text: content.trim() });
    } else if (message.kind === 'tool_use') {
      rows.push({ id, role: 'tool', text: message.toolName || 'Инструмент' });
    } else if (message.kind === 'error' && content.trim()) {
      rows.push({ id, role: 'error', text: content.trim() });
    }
  });
  return rows;
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

/**
 * Drafts, scroll and engine options of the panes, by tab id — outside the
 * component: the canvas renders only the active tab, so switching tabs
 * unmounts the pane and must not lose what was typed.
 */
export function createSideChatStore() {
  const drafts = new Map<string, string>();
  const scrolls = new Map<string, number>();
  const engines = new Map<string, SideChatEngine>();
  return {
    getDraft: (key: string): string => drafts.get(key) ?? '',
    setDraft: (key: string, text: string): void => {
      if (text) drafts.set(key, text);
      else drafts.delete(key);
    },
    getScroll: (key: string): number | null => scrolls.get(key) ?? null,
    setScroll: (key: string, top: number): void => {
      scrolls.set(key, top);
    },
    /** Engine options of a chat (by session id), e.g. from the side-chat answer. */
    getEngine: (sessionId: string): SideChatEngine | null => engines.get(sessionId) ?? null,
    setEngine: (sessionId: string, engine: SideChatEngine): void => {
      engines.set(sessionId, engine);
    },
  };
}

export type SideChatStore = ReturnType<typeof createSideChatStore>;

export const sideChatStore: SideChatStore = createSideChatStore();

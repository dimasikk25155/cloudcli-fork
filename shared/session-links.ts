/**
 * Chat links shared by server and client: a chat may grow out of another one
 * as its continuation (`relay`, эстафета) or as a thread (`thread`, тред).
 * The server stores the link on the child (`sessions.parent_session_id`,
 * `sessions.relation`) and serves it from `GET /api/sessions/:id/links` and
 * as `links` on every sidebar session.
 */

export const SESSION_RELATIONS = ['relay', 'thread'] as const;

export type SessionRelation = (typeof SESSION_RELATIONS)[number];

export function isSessionRelation(value: unknown): value is SessionRelation {
  return typeof value === 'string' && (SESSION_RELATIONS as readonly string[]).includes(value);
}

/** The other side of a link, enough to label and open it. */
export type SessionLinkRef = {
  /** App session id (the one in `/session/:id`). */
  sessionId: string;
  /** Relation of the CHILD to its parent, on both sides of the link. */
  relation: SessionRelation;
  /** Custom name of the linked chat; null = unnamed (UI shows its "new session" label). */
  name: string | null;
  provider: string;
  /** ISO time the linked chat was created, or null. */
  createdAt: string | null;
  isArchived: boolean;
};

/** `{parent?, children[]}`: parent is absent when the chat is not a child; children oldest first. */
export type SessionLinks = {
  parent?: SessionLinkRef;
  children: SessionLinkRef[];
};

/**
 * Chat links shared by server and client: a chat may grow out of another one
 * as its continuation (`relay`, эстафета) or as a thread (`thread`, тред).
 * The server stores the link on the child (`sessions.parent_session_id`,
 * `sessions.relation`) and serves it from `GET /api/sessions/:id/links` and
 * as `links` on every sidebar session.
 */
export const SESSION_RELATIONS = ['relay', 'thread'];
export function isSessionRelation(value) {
    return typeof value === 'string' && SESSION_RELATIONS.includes(value);
}
//# sourceMappingURL=session-links.js.map
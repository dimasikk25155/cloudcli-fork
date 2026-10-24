import { sessionLinksDb } from '../../modules/database/index.js';
import { canAccessSession } from '../../shared/project-access.js';
import { sqliteTimestampToIso } from '../../shared/sqlite-time.js';
import { AppError, canonicalizeProjectPath } from '../../shared/utils.js';
import { isSessionRelation, } from '../../../shared/session-links.js';
// A parent chain longer than this is treated as broken data, not walked further.
const MAX_ANCESTRY_DEPTH = 100;
function toRef(row, relation) {
    return {
        sessionId: row.session_id,
        relation,
        name: row.custom_name?.trim() ? row.custom_name : null,
        provider: row.provider,
        createdAt: sqliteTimestampToIso(row.created_at),
        isArchived: Boolean(row.isArchived),
    };
}
function refused(message, code, statusCode) {
    throw new AppError(message, { code, statusCode });
}
/** True when `candidateId` is `sessionId` itself or one of its ancestors. */
function isSelfOrAncestor(sessionId, candidateId) {
    let current = sessionId;
    for (let depth = 0; current && depth < MAX_ANCESTRY_DEPTH; depth += 1) {
        if (current === candidateId)
            return true;
        current = sessionLinksDb.getRow(current)?.parent_session_id ?? null;
    }
    return false;
}
/**
 * Links an existing chat to its parent. Refused (AppError, nothing stored) when:
 * relation is not relay/thread (400 SESSION_LINK_INVALID_RELATION); either chat
 * is missing (404 SESSION_NOT_FOUND / PARENT_SESSION_NOT_FOUND); the user may not
 * see either chat (403 SESSION_ACCESS_DENIED / PARENT_SESSION_ACCESS_DENIED); the
 * chats live in different projects (400 SESSION_LINK_OTHER_PROJECT); the link
 * would make a loop, incl. a chat to itself (400 SESSION_LINK_CYCLE); the child
 * already has another parent (409 SESSION_LINK_ALREADY_LINKED). Linking the same
 * pair again with the same relation is a no-op. Returns the child's links.
 */
export function linkSession({ childSessionId, parentSessionId, relation, user }) {
    const child = sessionLinksDb.getRow(childSessionId);
    if (!child)
        refused('Чат не найден', 'SESSION_NOT_FOUND', 404);
    if (!canAccessSession(user, childSessionId))
        refused('Нет доступа к чату', 'SESSION_ACCESS_DENIED', 403);
    const validRelation = checkParent({ parentSessionId, relation, user, projectPath: child.project_path });
    if (child.parent_session_id) {
        if (child.parent_session_id === parentSessionId && child.relation === validRelation) {
            return getLinksOfRow(child, { includeArchived: true });
        }
        refused('У чата уже есть родитель', 'SESSION_LINK_ALREADY_LINKED', 409);
    }
    if (isSelfOrAncestor(parentSessionId, childSessionId)) {
        refused('Связь замкнула бы цепочку чатов', 'SESSION_LINK_CYCLE', 400);
    }
    sessionLinksDb.setParent(childSessionId, parentSessionId, validRelation);
    return getLinksOfRow({ ...child, parent_session_id: parentSessionId, relation: validRelation }, { includeArchived: true });
}
/** Relation, parent existence, access to the parent and "same project" — the part of linkSession that needs no child row. */
function checkParent({ parentSessionId, relation, user, projectPath }) {
    if (!isSessionRelation(relation)) {
        refused('Вид связи должен быть relay или thread', 'SESSION_LINK_INVALID_RELATION', 400);
    }
    const parent = sessionLinksDb.getRow(parentSessionId);
    if (!parent)
        refused('Родительский чат не найден', 'PARENT_SESSION_NOT_FOUND', 404);
    if (!canAccessSession(user, parentSessionId)) {
        refused('Нет доступа к родительскому чату', 'PARENT_SESSION_ACCESS_DENIED', 403);
    }
    if (!projectPath || projectPath !== parent.project_path) {
        refused('Связать можно только чаты одного проекта', 'SESSION_LINK_OTHER_PROJECT', 400);
    }
    return relation;
}
/**
 * Vets a parent for a chat that is about to be created in `projectPath`
 * (same refusals as linkSession, same codes) — called BEFORE anything is
 * written, so a refusal leaves neither a session nor a project row behind.
 */
export function assertCanLinkNewChild(input) {
    return checkParent({ ...input, projectPath: canonicalizeProjectPath(input.projectPath) || null });
}
function getLinksOfRow(row, options = {}) {
    return linksForRows([row], options).get(row.session_id) ?? { children: [] };
}
/**
 * Links of many chats in two queries, for list views (sidebar pages, upsert
 * frames). No access check here: links never cross a project (enforced by
 * `linkSession` and re-checked below), so whoever may list these chats may
 * see their links. Archived chats are left out unless `includeArchived`.
 */
export function linksForSessions(sessionIds, options = {}) {
    return linksForRows(sessionLinksDb.getRows(sessionIds), options);
}
export function linksForRows(rows, options = {}) {
    const includeArchived = options.includeArchived === true;
    const visible = (row) => includeArchived || !row.isArchived;
    const result = new Map();
    if (rows.length === 0)
        return result;
    const parentIds = rows.map((row) => row.parent_session_id).filter((id) => Boolean(id));
    const parents = new Map(sessionLinksDb.getRows(parentIds).map((row) => [row.session_id, row]));
    const children = sessionLinksDb.getChildren(rows.map((row) => row.session_id));
    for (const row of rows) {
        const links = { children: [] };
        const parent = row.parent_session_id ? parents.get(row.parent_session_id) : undefined;
        if (parent && isSessionRelation(row.relation) && parent.project_path === row.project_path && visible(parent)) {
            links.parent = toRef(parent, row.relation);
        }
        for (const child of children) {
            if (child.parent_session_id === row.session_id
                && isSessionRelation(child.relation)
                && child.project_path === row.project_path
                && visible(child)) {
                links.children.push(toRef(child, child.relation));
            }
        }
        result.set(row.session_id, links);
    }
    return result;
}
/**
 * `GET /api/sessions/:id/links`: `{parent?, children[]}` of one chat, archived
 * linked chats included (flagged `isArchived`). 404 SESSION_NOT_FOUND /
 * 403 SESSION_ACCESS_DENIED.
 */
export function getSessionLinks(sessionId, user) {
    const row = sessionLinksDb.getRow(sessionId);
    if (!row)
        refused('Чат не найден', 'SESSION_NOT_FOUND', 404);
    if (!canAccessSession(user, sessionId))
        refused('Нет доступа к чату', 'SESSION_ACCESS_DENIED', 403);
    return getLinksOfRow(row, { includeArchived: true });
}
/**
 * Sidebar links of an already loaded session row (sessionsDb rows carry
 * `parent_session_id` and `has_children`): no query at all when the chat has
 * neither a parent nor children.
 */
export function linksOfRow(row) {
    if (!row.parent_session_id && !row.has_children)
        return { children: [] };
    return linksForRows([row]).get(row.session_id) ?? { children: [] };
}
/** Parent and children of a chat (archived included): their cards show this chat's name/state. */
export function relatedSessionIds(sessionId) {
    const row = sessionLinksDb.getRow(sessionId);
    if (!row)
        return [];
    const ids = sessionLinksDb.getChildren([sessionId]).map((child) => child.session_id);
    if (row.parent_session_id)
        ids.unshift(row.parent_session_id);
    return ids;
}
//# sourceMappingURL=session-links.service.js.map
/**
 * The sidebar's tree of nested chats (modSideChat): a child — thread, relay
 * continuation or side chat — is listed right under its parent, indented,
 * and a parent can fold its branch. Only links inside the loaded list count:
 * a child whose parent is not loaded stays a top-level card (its caption
 * still names the parent).
 */
import type { SessionLinks } from '../../../../shared/session-links';

export type SessionTreeRow<T> = {
  session: T;
  /** 0 = top-level card. */
  depth: number;
  /** Direct children in the list (folded or not). */
  childCount: number;
  /** The branch below is folded. */
  collapsed: boolean;
};

type TreeSession = { id: string | number; links?: SessionLinks };

/** Rows in display order; `collapsed` holds the ids of folded parents. */
export function buildSessionTree<T extends TreeSession>(sessions: T[], collapsed: ReadonlySet<string>): SessionTreeRow<T>[] {
  const ids = new Set(sessions.map((session) => String(session.id)));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  for (const session of sessions) {
    const id = String(session.id);
    const parentId = session.links?.parent?.sessionId;
    if (parentId && parentId !== id && ids.has(parentId)) {
      const list = children.get(parentId) ?? [];
      list.push(session);
      children.set(parentId, list);
    } else {
      roots.push(session);
    }
  }

  const rows: SessionTreeRow<T>[] = [];
  const placed = new Set<string>();
  const visit = (session: T, depth: number) => {
    const id = String(session.id);
    if (placed.has(id)) return;
    placed.add(id);
    const kids = children.get(id) ?? [];
    const folded = kids.length > 0 && collapsed.has(id);
    rows.push({ session, depth, childCount: kids.length, collapsed: folded });
    if (folded) {
      // Folded descendants are not shown, but they are placed: no loop fallback for them.
      const hide = (node: T) => (children.get(String(node.id)) ?? []).forEach((kid) => {
        if (!placed.has(String(kid.id))) {
          placed.add(String(kid.id));
          hide(kid);
        }
      });
      hide(session);
      return;
    }
    kids.forEach((kid) => visit(kid, depth + 1));
  };
  roots.forEach((root) => visit(root, 0));
  // A parent loop in broken data has no root: those chats are shown flat.
  sessions.forEach((session) => {
    if (!placed.has(String(session.id))) visit(session, 0);
  });
  return rows;
}

/**
 * Кадры-слайды документа: первый набор ≥2 из `[data-slide]`, `.slide`,
 * `section` у одного родителя. Порядок кадров меняет операция `frameOrder`.
 */

import { NEO3_ID_ATTR } from './editorModel';

/** One element matching a frame rule: `rule` 0 = `[data-slide]`, 1 = `.slide`, 2 = `section`; in document order. */
export interface FrameCandidate { id: string; parentKey: string; rule: number }

export const FRAME_SELECTORS = ['[data-slide]', '.slide', 'section'] as const;

/**
 * The frame set: rules in priority order; within a rule — the first parent
 * (by first appearance) with at least two matches. SELF-CONTAINED: the bridge
 * inlines its `toString()`.
 */
export function pickFrameSet(candidates: FrameCandidate[]): string[] {
  for (let rule = 0; rule < 3; rule += 1) {
    const order: string[] = [];
    const groups: Record<string, string[]> = {};
    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      if (item.rule !== rule) continue;
      if (!Object.prototype.hasOwnProperty.call(groups, item.parentKey)) {
        groups[item.parentKey] = [];
        order.push(item.parentKey);
      }
      if (groups[item.parentKey].indexOf(item.id) < 0) groups[item.parentKey].push(item.id);
    }
    for (let i = 0; i < order.length; i += 1) if (groups[order[i]].length >= 2) return groups[order[i]];
  }
  return [];
}

/** New order after dragging the frame at `from` to `to` (past the end — to the end; bad `from` — unchanged). */
export function moveFrame(order: string[], from: number, to: number): string[] {
  if (!Number.isInteger(from) || from < 0 || from >= order.length || !Number.isInteger(to)) return order.slice();
  const next = order.slice();
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/** Candidates of a document: elements with an id matching a frame rule, keyed by their parent. */
export function frameCandidates(doc: Document): FrameCandidate[] {
  const parentKeys = new Map<Node, string>();
  const keyOf = (parent: Node | null) => {
    if (!parent) return '';
    let key = parentKeys.get(parent);
    if (!key) {
      key = `p${parentKeys.size + 1}`;
      parentKeys.set(parent, key);
    }
    return key;
  };
  const out: FrameCandidate[] = [];
  FRAME_SELECTORS.forEach((selector, rule) => {
    for (const element of Array.from(doc.querySelectorAll(selector))) {
      const id = element.getAttribute(NEO3_ID_ATTR);
      if (id) out.push({ id, parentKey: keyOf(element.parentNode), rule });
    }
  });
  return out;
}

/** Ids of the frames of an instrumented document, in document order; [] — not a deck. */
export function findFrames(doc: Document): string[] {
  return pickFrameSet(frameCandidates(doc));
}

/**
 * A thumbnail at `from` dropped before the one at `before` (0…length; length —
 * at the end) → the new frame order; null — nothing moves.
 */
export function frameDropOrder(order: string[], from: number, before: number): string[] | null {
  if (!Number.isInteger(from) || from < 0 || from >= order.length || !Number.isInteger(before)) return null;
  const target = Math.max(0, Math.min(before, order.length));
  if (target === from || target === from + 1) return null;
  return moveFrame(order, from, target > from ? target - 1 : target);
}

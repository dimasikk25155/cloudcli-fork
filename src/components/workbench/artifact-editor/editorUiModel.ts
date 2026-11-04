/**
 * Чистая модель интерфейса правки (без DOM): выделение, история действий,
 * пересчёт координат с масштабом, цель перестановки в flex/grid, ручки
 * размера, единицы SVG, значения панели свойств.
 */

import type { ArtifactDetail } from '../../../../shared/artifacts';

import type { EditorDocKind, EditorOp, StackEntry } from './editorModel';
import type { ParentLayout } from './editorProtocol';
import type { Rect } from './snap';

export const SNAP_GRID = 8;
/** Snap distance in screen pixels (divided by zoom for the document). */
export const SNAP_THRESHOLD_PX = 6;
/** A press that moved less than this is a click, not a drag. */
export const DRAG_START_PX = 3;
export const HISTORY_LIMIT = 200;

// ---------- Selection ----------

/** Click → only this element; Shift → toggle it (the last one is the primary). */
export function pickSelection(current: string[], id: string, shift: boolean): string[] {
  if (!shift) return [id];
  return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
}

/** Drops ids the document no longer has. */
export function pruneSelection(current: string[], exists: (id: string) => boolean): string[] {
  const next = current.filter(exists);
  return next.length === current.length ? current : next;
}

// ---------- History ----------

/** Undo/redo by user actions: one action (a group of operations) — one step. */
export interface EditorHistory {
  push(group: StackEntry[]): void;
  /** The group to undo (apply each `inverse`, last first). */
  undo(): StackEntry[] | null;
  /** The group to redo (apply each `op`, first first). */
  redo(): StackEntry[] | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Applied groups, oldest first. */
  groups(): StackEntry[][];
  /** Undone groups, the next to redo last. */
  undoneGroups(): StackEntry[][];
  /** Applied operations, flat. */
  ops(): EditorOp[];
  /** Undone operations, flat (the next to redo last). */
  undoneOps(): EditorOp[];
  /** Replaces the operation of the last action if it is a single one (the inverse stays). */
  amendLast(op: EditorOp): boolean;
  /** Serial of the last applied action (changes on every push/undo/redo/amend). */
  readonly topSerial: number;
  /** The document now is what was last saved. */
  markSaved(): void;
  readonly dirty: boolean;
  /** New applied groups (replayed on a changed source): redo is dropped. */
  replace(groups: StackEntry[][]): void;
}

type Step = { serial: number; entries: StackEntry[] };

export function createEditorHistory(limit = HISTORY_LIMIT): EditorHistory {
  let done: Step[] = [];
  let undone: Step[] = [];
  let serial = 0;
  let saved = 0;
  const top = () => done.at(-1)?.serial ?? 0;
  const step = (entries: StackEntry[]): Step => {
    serial += 1;
    return { serial, entries };
  };
  return {
    push(group) {
      if (group.length === 0) return;
      done.push(step(group));
      if (done.length > limit) done = done.slice(done.length - limit);
      undone = [];
    },
    undo() {
      const last = done.pop();
      if (!last) return null;
      undone.push(last);
      return last.entries;
    },
    redo() {
      const next = undone.pop();
      if (!next) return null;
      done.push(next);
      return next.entries;
    },
    get canUndo() {
      return done.length > 0;
    },
    get canRedo() {
      return undone.length > 0;
    },
    groups: () => done.map((s) => s.entries.slice()),
    undoneGroups: () => undone.map((s) => s.entries.slice()),
    ops: () => done.flatMap((s) => s.entries.map((e) => e.op)),
    undoneOps: () => undone.flatMap((s) => s.entries.map((e) => e.op)),
    amendLast(op) {
      const last = done.at(-1);
      if (!last || last.entries.length !== 1) return false;
      serial += 1;
      done[done.length - 1] = { serial, entries: [{ ...last.entries[0], op }] };
      undone = [];
      return true;
    },
    get topSerial() {
      return top();
    },
    markSaved() {
      saved = top();
    },
    get dirty() {
      return top() !== saved;
    },
    replace(groups) {
      done = groups.filter((g) => g.length > 0).slice(-limit).map(step);
      undone = [];
    },
  };
}

// ---------- Coordinates ----------

export interface ViewTransform { zoom: number; scrollX: number; scrollY: number }

/** Bridge rects are CSS pixels of the iframe document; the overlay is on screen: minus scroll, times zoom. */
export function docRectToScreen(rect: Rect, view: ViewTransform): Rect {
  return {
    x: (rect.x - view.scrollX) * view.zoom,
    y: (rect.y - view.scrollY) * view.zoom,
    w: rect.w * view.zoom,
    h: rect.h * view.zoom,
  };
}

/** A pointer point on the stage (screen px from its top-left) → document px. */
export function screenPointToDoc(point: { x: number; y: number }, view: ViewTransform): { x: number; y: number } {
  return { x: point.x / view.zoom + view.scrollX, y: point.y / view.zoom + view.scrollY };
}

export function screenDeltaToDoc(dx: number, dy: number, zoom: number): { dx: number; dy: number } {
  return { dx: dx / zoom, dy: dy / zoom };
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const topEdge = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x: left, y: topEdge, w: right - left, h: bottom - topEdge };
}

// ---------- Reorder in flex/grid ----------

export type SiblingBox = { id: string; rect: Rect };

/**
 * Where a dragged element of a flex/grid container lands: before the first
 * neighbour (document order) that lies after the pointer; none — to the end.
 * `line` — the insertion marker in document px (zero width or height).
 */
export function reorderTarget(point: { x: number; y: number }, siblings: SiblingBox[], layout: ParentLayout): { beforeId: string | null; line: Rect } {
  const after = (rect: Rect): boolean => {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    if (layout === 'flex-col' || layout === 'block') return point.y < cy;
    if (layout === 'flex-row') return point.x < cx;
    // grid: row by row
    if (point.y < rect.y) return true;
    return point.y < rect.y + rect.h && point.x < cx;
  };
  const vertical = layout === 'flex-col' || layout === 'block';
  const target = siblings.find((sibling) => after(sibling.rect));
  if (target) {
    const r = target.rect;
    return { beforeId: target.id, line: vertical ? { x: r.x, y: r.y, w: r.w, h: 0 } : { x: r.x, y: r.y, w: 0, h: r.h } };
  }
  const last = siblings.at(-1)?.rect;
  if (!last) return { beforeId: null, line: { x: point.x, y: point.y, w: 0, h: 0 } };
  return {
    beforeId: null,
    line: vertical ? { x: last.x, y: last.y + last.h, w: last.w, h: 0 } : { x: last.x + last.w, y: last.y, w: 0, h: last.h },
  };
}

/** `nextId` — the neighbour with an id right after the element now (null — it is the last). */
export function isReorderNoop(input: { beforeId: string | null; nextId: string | null }): boolean {
  return input.beforeId === input.nextId;
}

// ---------- Resize ----------

export type ResizeHandle = 'e' | 's' | 'se';
export const MIN_SIZE = 4;

/** New size in document px from a handle drag; snap rounds to the grid; never below 4 px. */
export function resizeFromHandle(start: Rect, handle: ResizeHandle, dx: number, dy: number, opts: { grid: number; snap: boolean }): { w: number; h: number } {
  const fit = (value: number) => {
    const snapped = opts.snap && opts.grid > 0 ? Math.round(value / opts.grid) * opts.grid : value;
    return Math.max(MIN_SIZE, Math.round(snapped * 100) / 100);
  };
  return {
    w: handle === 's' ? start.w : fit(start.w + dx),
    h: handle === 'e' ? start.h : fit(start.h + dy),
  };
}

// ---------- SVG units ----------

/**
 * How many user units of an `<svg>` make one CSS pixel: viewBox width over
 * the drawn width (the numeric `width` attribute, else the measured one).
 * No viewBox — one unit is one pixel.
 */
export function svgUnitsPerPx(input: { viewBox: string | null; width: string | null; renderedWidth: number | null }): number {
  const parts = (input.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0) return 1;
  const attr = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(input.width ?? '');
  const drawn = attr ? Number(attr[1]) : input.renderedWidth;
  return drawn && drawn > 0 ? parts[2] / drawn : 1;
}

// ---------- Panel values ----------

export const SYSTEM_FONTS = [
  'system-ui, sans-serif',
  'Arial, sans-serif',
  'Helvetica, Arial, sans-serif',
  'Georgia, serif',
  '"Times New Roman", serif',
  'Verdana, sans-serif',
  '"Courier New", monospace',
  'monospace',
];

/** `font-family` values found in style texts (attributes and `<style>`), first appearance first. */
export function fontFamiliesIn(texts: string[]): string[] {
  const out: string[] = [];
  const re = /font-family\s*:\s*([^;}]+)/gi;
  for (const text of texts) {
    for (let match = re.exec(text); match; match = re.exec(text)) {
      const value = match[1].replace(/\s*!important\s*$/i, '').trim();
      if (value && value.length <= 200 && !out.includes(value)) out.push(value);
    }
  }
  return out;
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** `#rrggbb` for `<input type=color>`; null — not a plain colour (variables, names, gradients). */
export function toHexColor(value: string | null): string | null {
  const text = (value ?? '').trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const rgb = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/.exec(text);
  if (rgb) return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;
  return null;
}

/** `12px` / `12` → 12; other units — null. */
export function pxNumber(value: string | null): number | null {
  const match = /^\s*(-?[\d.]+)\s*(px)?\s*$/i.exec(value ?? '');
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

// ---------- What can be edited ----------

const SVG_PATH = /\.svg$/i;
const EDITABLE_PATH = /\.(?:html?|svg)$/i;

export function editorDocKind(filePath: string): EditorDocKind {
  return SVG_PATH.test(filePath) ? 'svg' : 'html';
}

/** HTML, slides and SVG pictures whose file is on disk (raster pictures — comments and «Попросить агента» only). */
export function canEditArtifact(detail: ArtifactDetail): boolean {
  const { kind, path } = detail.artifact;
  if (!detail.file.exists || !EDITABLE_PATH.test(path)) return false;
  return kind === 'html' || kind === 'slides' || (kind === 'image' && SVG_PATH.test(path));
}

/** Value of one declaration of a `style` attribute (the last one wins); `;` inside quotes or brackets does not split. */
export function readInlineStyle(style: string | null, prop: string): string | null {
  const text = style ?? '';
  let found: string | null = null;
  let quote = '';
  let depth = 0;
  let start = 0;
  const take = (end: number) => {
    const decl = text.slice(start, end);
    const colon = decl.indexOf(':');
    if (colon >= 0 && decl.slice(0, colon).trim().toLowerCase() === prop) found = decl.slice(colon + 1).trim();
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      take(i);
      start = i + 1;
    }
  }
  take(text.length);
  return found;
}

/**
 * «Текст готов/отменён» from the page counts only for the element the parent
 * itself put into text editing: a page script cannot invent a text edit.
 */
export function acceptsTextEnd(editingText: string | null, messageId: string): boolean {
  return editingText !== null && editingText === messageId;
}

/** Below this canvas width the slide rail and the properties panel fold behind buttons. */
export const EDITOR_NARROW_PX = 640;

export function isNarrowEditor(width: number): boolean {
  return width > 0 && width < EDITOR_NARROW_PX;
}

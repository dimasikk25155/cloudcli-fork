/**
 * Модель правки артефакта «как в Figma» (мод «Правка артефактов»).
 *
 * Правка идёт над разобранной копией ИСХОДНИКА (`DOMParser`, скрипты не
 * выполняются), а не над живым DOM превью: каждому элементу исходника
 * ставится `data-neo3-id` (порядок обхода), копия с мостом уходит в iframe,
 * операции применяются и там (для вида), и в копии (для сохранения).
 * Сохранение — сериализация копии без `data-neo3-id`: в файл не попадают ни
 * мост, ни то, что нарисовали скрипты страницы; `<script>`/`<style>` и
 * подключённые CSS не меняются.
 *
 * `applyOpToDocument` самодостаточна — без импортов и имён модуля: её
 * `toString()` вставляется в мост (`bridge.ts`).
 */

export type EditorDocKind = 'html' | 'svg';

export type StyleProp = 'color' | 'background-color' | 'font-family' | 'font-size' | 'font-weight'
  | 'margin-top' | 'margin-right' | 'margin-bottom' | 'margin-left'
  | 'padding-top' | 'padding-right' | 'padding-bottom' | 'padding-left' | 'fill' | 'stroke' | 'opacity';

export const STYLE_PROPS: readonly StyleProp[] = [
  'color', 'background-color', 'font-family', 'font-size', 'font-weight',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'fill', 'stroke', 'opacity',
];

/** Raw attributes an inverse operation puts back. */
export type RestorableAttr = 'style' | 'transform' | 'width' | 'height';

export type EditorOp =
  | { type: 'translate'; id: string; dx: number; dy: number } // HTML — CSS `translate` (не трогает transform страницы); SVG — transform="translate(…) …"
  | { type: 'reorder'; id: string; beforeId: string | null } // среди соседей того же родителя; null = после последнего соседа с id
  | { type: 'resize'; id: string; width: number; height: number } // px, минимум 4
  | { type: 'text'; id: string; text: string } // только элементы, где все дети — текст
  | { type: 'style'; id: string; prop: StyleProp; value: string | null } // null = убрать свойство
  | { type: 'hide'; id: string; hidden: boolean }
  | { type: 'remove'; id: string }
  | { type: 'duplicate'; id: string; newId: string } // копия сразу после оригинала, потомки — `${newId}.${n}`
  | { type: 'layer'; id: string; dir: 'up' | 'down' } // на одного соседа с id (up = позже в DOM = выше)
  | { type: 'frameOrder'; ids: string[] } // новый порядок кадров-слайдов
  // Только обратные операции (их строит inverseOp):
  | { type: 'attrs'; id: string; attrs: Partial<Record<RestorableAttr, string | null>> } // вернуть сырые атрибуты
  | { type: 'unremove'; id: string } // вернуть удалённый элемент на место
  | { type: 'unmove'; id: string }; // вернуть перемещённый (reorder/layer) элемент на прежнее место

export const NEO3_ID_ATTR = 'data-neo3-id';

export interface ElementFingerprint {
  /** Tags and indexes among element children from `<body>` (HTML) or the svg root: `div:1/p:0`. */
  path: string;
  /** First 40 characters of the collapsed textContent. */
  textStart: string;
}

export interface StackEntry {
  op: EditorOp;
  inverse: EditorOp;
  fp: ElementFingerprint | null;
  /** Fingerprints of the other ids an operation names (reorder `beforeId`, frameOrder `ids`). */
  related?: Record<string, ElementFingerprint | null>;
}

export interface OpStack {
  push(entry: StackEntry): void;
  /** The entry to undo: apply `entry.inverse`. */
  undo(): StackEntry | null;
  /** The entry to redo: apply `entry.op`. */
  redo(): StackEntry | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Applied entries, oldest first (undone ones are not included). */
  entries(): StackEntry[];
  clear(): void;
}

/**
 * Source text kept verbatim around `<body>`: everything up to the end of the
 * `<body …>` tag and from `</body>` to the end. `trailing` — whitespace after
 * `</body>` that the parser moved into the body (dropped on save).
 */
type BodySplice = { prefix: string; suffix: string; trailing: string };
type DocMeta = { kind: EditorDocKind; doctype: string | null; xmlDecl: string | null; trailingNewline: boolean; splice: BodySplice | null };
const docMeta = new WeakMap<Document, DocMeta>();

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Not edited and not given an id: page machinery and non-rendered SVG parts. */
const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'base', 'title', 'head', 'html', 'body', 'defs', 'desc', 'metadata']);
const SKIP_INSIDE = 'noscript, template, defs, clipPath, mask, pattern, marker, symbol, linearGradient, radialGradient, filter';

const localTag = (element: Element) => element.localName.toLowerCase();

function instrumentable(element: Element): boolean {
  if (SKIP_TAGS.has(localTag(element))) return false;
  const parent = element.parentElement;
  return !(parent && parent.closest(SKIP_INSIDE));
}

/** Root the editor works under: `<body>` of a page, the svg root of a picture. */
function containerOf(doc: Document): Element | null {
  const meta = docMeta.get(doc);
  if (meta?.kind === 'svg' || doc.documentElement?.namespaceURI === SVG_NS) return doc.documentElement;
  return doc.body;
}

function findById(doc: Document, id: string): Element | null {
  const list = doc.querySelectorAll(`[${NEO3_ID_ATTR}]`);
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].getAttribute(NEO3_ID_ATTR) === id) return list[index];
  }
  return null;
}

/** A custom element: lands in the body in any parser mode (a comment before <html> would not). */
const SPLICE_MARK = 'neo3-body-splice';

/**
 * Where the body content sits in the source text. A candidate split is
 * accepted only if the source with the body content replaced by a marker
 * parses into the same `<head>` and a body holding just the marker (plus
 * whitespace) — a `<body` inside a script string or a comment fails that.
 */
function findBodySplice(source: string, parser: DOMParser, doc: Document): BodySplice | null {
  const headHtml = doc.head?.outerHTML ?? '';
  const lower = source.toLowerCase();
  const closeAt = lower.lastIndexOf('</body');
  const close = closeAt >= 0 && /^<\/body\s*>/i.test(source.slice(closeAt)) ? closeAt : source.length;
  const opens: number[] = [];
  const openRe = /<body(?=[\s>/])[^>]*>/gi;
  for (let match = openRe.exec(source); match && match.index < close && opens.length < 5; match = openRe.exec(source)) {
    opens.push(match.index + match[0].length);
  }
  if (opens.length === 0 && close === source.length) opens.push(0);
  for (const end of opens) {
    const prefix = source.slice(0, end);
    const suffix = source.slice(close);
    const probe = parser.parseFromString(`${prefix}<${SPLICE_MARK}></${SPLICE_MARK}>${suffix}`, 'text/html');
    const [first, ...rest] = Array.from(probe.body?.childNodes ?? []);
    if (!first || first.nodeType !== 1 || (first as Element).localName !== SPLICE_MARK || first.childNodes.length > 0) continue;
    if (rest.some((node) => node.nodeType !== 3 || /\S/.test(node.nodeValue ?? ''))) continue;
    if ((probe.head?.outerHTML ?? '') !== headHtml) continue;
    return { prefix, suffix, trailing: rest.map((node) => node.nodeValue ?? '').join('') };
  }
  return null;
}

/**
 * Parses the source (scripts do not run) and gives every editable element a
 * `data-neo3-id` in traversal order: `1`, `2`, … Ids live one editing session.
 */
export function instrumentSource(source: string, kind: EditorDocKind): { doc: Document; count: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, kind === 'svg' ? 'image/svg+xml' : 'text/html');
  if (kind === 'svg') {
    const error = doc.getElementsByTagName('parsererror')[0];
    if (error || doc.documentElement?.localName !== 'svg') {
      throw new Error(`SVG не разобрался: ${(error?.textContent ?? 'нет корня <svg>').trim().slice(0, 200)}`);
    }
  }
  const doctype = kind === 'html' ? (/^\uFEFF?\s*(<!doctype[^>]*>)/i.exec(source)?.[1] ?? null) : null;
  const xmlDecl = kind === 'svg' ? (/^\uFEFF?\s*(<\?xml[^>]*\?>)/.exec(source)?.[1] ?? null) : null;
  const splice = kind === 'html' ? findBodySplice(source, parser, doc) : null;
  docMeta.set(doc, { kind, doctype, xmlDecl, trailingNewline: /\n$/.test(source), splice });

  for (const element of Array.from(doc.querySelectorAll(`[${NEO3_ID_ATTR}]`))) element.removeAttribute(NEO3_ID_ATTR);
  const container = containerOf(doc);
  let count = 0;
  if (container) {
    const elements = kind === 'svg' ? [container, ...Array.from(container.querySelectorAll('*'))] : Array.from(container.querySelectorAll('*'));
    for (const element of elements) {
      if (element === container || instrumentable(element)) {
        count += 1;
        element.setAttribute(NEO3_ID_ATTR, String(count));
      }
    }
  }
  return { doc, count };
}

function serializeNodes(doc: Document, meta: DocMeta | undefined): string {
  const parts: string[] = [];
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === 10) {
      const type = node as DocumentType;
      parts.push(meta?.doctype ?? `<!DOCTYPE ${type.name}${type.publicId ? ` PUBLIC "${type.publicId}"` : ''}${type.systemId ? `${type.publicId ? '' : ' SYSTEM'} "${type.systemId}"` : ''}>`);
    } else if (node.nodeType === 1) {
      parts.push((node as Element).outerHTML);
    } else if (node.nodeType === 8) {
      parts.push(`<!--${(node as Comment).data}-->`);
    }
  }
  return parts.join('\n');
}

function withEnding(text: string, meta: DocMeta | undefined): string {
  return meta?.trailingNewline && !text.endsWith('\n') ? `${text}\n` : text;
}

/** The copy for the iframe: ids kept, the bridge first in `<head>`; SVG — inside an HTML wrapper. */
export function previewHtml(doc: Document, kind: EditorDocKind, bridge: string): string {
  const meta = docMeta.get(doc);
  const clone = doc.cloneNode(true) as Document;
  for (const old of Array.from(clone.querySelectorAll('script[data-neo3-bridge]'))) old.remove();
  if (kind === 'svg') {
    const svg = new XMLSerializer().serializeToString(clone.documentElement);
    return `<!DOCTYPE html><html><head>${bridge}<meta charset="utf-8"><style>html,body{margin:0}</style></head><body>${svg}</body></html>`;
  }
  const marker = `neo3-bridge-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  let head = clone.head;
  if (!head) {
    head = clone.createElement('head');
    clone.documentElement.insertBefore(head, clone.documentElement.firstChild);
  }
  head.insertBefore(clone.createComment(marker), head.firstChild);
  return serializeNodes(clone, meta).replace(`<!--${marker}-->`, () => bridge);
}

/**
 * Back to the file: no `data-neo3-id`, no bridge. HTML — the source text
 * before `<body …>` and after `</body>` is kept verbatim (head scripts and
 * styles byte for byte), only the body content is serialized; when the body
 * cannot be located in the text — the whole document, doctype kept. SVG —
 * XMLSerializer, the XML declaration kept.
 */
export function serializeDocument(doc: Document, kind: EditorDocKind): string {
  const meta = docMeta.get(doc);
  const clone = doc.cloneNode(true) as Document;
  for (const element of Array.from(clone.querySelectorAll(`[${NEO3_ID_ATTR}]`))) element.removeAttribute(NEO3_ID_ATTR);
  for (const bridge of Array.from(clone.querySelectorAll('script[data-neo3-bridge]'))) bridge.remove();
  if (kind === 'svg') {
    const body = new XMLSerializer().serializeToString(clone);
    return withEnding(meta?.xmlDecl && !body.startsWith('<?xml') ? `${meta.xmlDecl}\n${body}` : body, meta);
  }
  if (meta?.splice && clone.body) {
    const { prefix, suffix, trailing } = meta.splice;
    let inner = clone.body.innerHTML;
    if (trailing && inner.endsWith(trailing)) inner = inner.slice(0, inner.length - trailing.length);
    return prefix + inner + suffix;
  }
  return withEnding(serializeNodes(clone, meta), meta);
}

/**
 * Applies one operation to a document (the parsed copy or the live iframe).
 * false — the operation does not fit (no element, wrong kind of element, bad value).
 *
 * SELF-CONTAINED: no imports, no module names, no outer closures — `bridge.ts`
 * inlines its `toString()`. Helpers live inside.
 */
export function applyOpToDocument(doc: Document, op: EditorOp): boolean {
  try {
    if (!doc || !op || typeof op !== 'object' || typeof (op as { type?: unknown }).type !== 'string') return false;
    const ATTR = 'data-neo3-id';
    const SVG = 'http://www.w3.org/2000/svg';
    const PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'fill', 'stroke', 'opacity'];
    const NO_TEXT = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'script', 'style', 'template', 'iframe', 'canvas', 'video', 'audio', 'select', 'textarea', 'object', 'picture', 'svg', 'math', 'html', 'head', 'body'];
    const SVG_TEXT = ['text', 'tspan'];
    const SVG_SIZED = ['rect', 'image', 'foreignobject', 'use', 'svg'];
    const RESTORABLE = ['style', 'transform', 'width', 'height'];
    const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
    const find = (id: unknown): Element | null => {
      if (!validId(id)) return null;
      const list = doc.querySelectorAll('[' + ATTR + ']');
      for (let i = 0; i < list.length; i += 1) if (list[i].getAttribute(ATTR) === id) return list[i];
      return null;
    };
    const finite = (value: unknown): value is number => typeof value === 'number' && isFinite(value) && Math.abs(value) <= 1e7;
    const fmt = (value: number) => String(Math.round(value * 100) / 100);
    // An SVG shape inside an <svg> (an outer <svg> is laid out by CSS like any HTML box).
    const svgGraphic = (el: Element) => el.namespaceURI === SVG && !!el.parentElement && el.parentElement.namespaceURI === SVG;
    const protectedEl = (el: Element) => el === doc.documentElement || el === doc.body || el === doc.head;
    // Declarations of a style attribute as [start, end) spans, split on top-level «;».
    const spans = (text: string): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      let quote = '';
      let depth = 0;
      let start = 0;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
          if (ch === '\\') i += 1;
          else if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ';' && depth === 0) {
          out.push([start, i]);
          start = i + 1;
        }
      }
      if (start < text.length) out.push([start, text.length]);
      return out;
    };
    const nameOf = (decl: string) => (decl.indexOf(':') < 0 ? '' : decl.slice(0, decl.indexOf(':')).trim().toLowerCase());
    const getProp = (el: Element, prop: string): string | null => {
      const text = el.getAttribute('style') || '';
      let found: string | null = null;
      const list = spans(text);
      for (let i = 0; i < list.length; i += 1) {
        const decl = text.slice(list[i][0], list[i][1]);
        if (nameOf(decl) === prop) found = decl.slice(decl.indexOf(':') + 1).trim();
      }
      return found;
    };
    // Edits one declaration in place; the rest of the attribute text stays byte for byte.
    const setProp = (el: Element, prop: string, value: string | null) => {
      let text = el.getAttribute('style') || '';
      const list = spans(text);
      let last = -1;
      for (let i = 0; i < list.length; i += 1) if (nameOf(text.slice(list[i][0], list[i][1])) === prop) last = i;
      if (value === null) {
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (nameOf(text.slice(list[i][0], list[i][1])) !== prop) continue;
          const end = text[list[i][1]] === ';' ? list[i][1] + 1 : list[i][1];
          text = text.slice(0, list[i][0]) + text.slice(end);
        }
      } else if (last >= 0) {
        const [start, end] = list[last];
        const decl = text.slice(start, end);
        const lead = decl.length - decl.replace(/^\s+/, '').length;
        const trail = decl.length - decl.replace(/\s+$/, '').length;
        text = text.slice(0, start + lead) + prop + ': ' + value + text.slice(end - trail);
      } else {
        const trimmed = text.replace(/\s+$/, '');
        text = trimmed + (trimmed && !/;$/.test(trimmed) ? '; ' : trimmed ? ' ' : '') + prop + ': ' + value + ';';
      }
      if (text.trim()) el.setAttribute('style', text);
      else el.removeAttribute('style');
    };
    const safeValue = (value: unknown): value is string => typeof value === 'string' && value.length <= 500 && !/[;{}<>\n\r]/.test(value);
    const idSiblings = (el: Element) => {
      const out: Element[] = [];
      const parent = el.parentElement;
      if (!parent) return out;
      for (let i = 0; i < parent.children.length; i += 1) {
        const child = parent.children[i];
        if (child !== el && child.hasAttribute(ATTR)) out.push(child);
      }
      return out;
    };
    type Stashed = { node: Element; parent: Node; next: Node | null };
    type Spot = { parent: Node; next: Node | null };
    // Hidden state on the document itself (works the same in the parsed copy and in the iframe):
    // removed elements and earlier positions of moved ones, for exact undo (LIFO).
    const holder = doc as unknown as { __neo3Removed?: Record<string, Stashed>; __neo3Moves?: Record<string, Spot[]> };
    const stash = (): Record<string, Stashed> => {
      if (!holder.__neo3Removed) holder.__neo3Removed = {};
      return holder.__neo3Removed;
    };
    const rememberSpot = (el: Element, id: string) => {
      if (!holder.__neo3Moves) holder.__neo3Moves = {};
      const list = holder.__neo3Moves[id] || (holder.__neo3Moves[id] = []);
      list.push({ parent: el.parentNode!, next: el.nextSibling });
      if (list.length > 500) list.shift();
    };
    const textOnly = (el: Element) => {
      const tag = el.localName.toLowerCase();
      if (el.namespaceURI === SVG ? SVG_TEXT.indexOf(tag) < 0 : NO_TEXT.indexOf(tag) >= 0) return false;
      for (let i = 0; i < el.childNodes.length; i += 1) if (el.childNodes[i].nodeType !== 3) return false;
      return true;
    };

    if (op.type === 'frameOrder') {
      const ids = op.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000) return false;
      const elements: Element[] = [];
      for (let i = 0; i < ids.length; i += 1) {
        const el = find(ids[i]);
        if (!el || elements.indexOf(el) >= 0 || (elements.length && el.parentNode !== elements[0].parentNode)) return false;
        elements.push(el);
      }
      const current = elements.slice().sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
      const slots = current.map((el) => {
        const slot = doc.createComment('neo3-slot');
        el.parentNode!.insertBefore(slot, el);
        return slot;
      });
      for (let i = 0; i < slots.length; i += 1) slots[i].parentNode!.replaceChild(elements[i], slots[i]);
      return true;
    }

    if (op.type === 'unremove') {
      const bag = stash();
      const entry = validId(op.id) ? bag[op.id] : undefined;
      if (!entry || find(op.id) || !entry.parent.isConnected) return false;
      entry.parent.insertBefore(entry.node, entry.next && entry.next.parentNode === entry.parent ? entry.next : null);
      delete bag[op.id];
      return true;
    }

    const el = find((op as { id?: unknown }).id);
    if (!el) return false;

    if (op.type === 'unmove') {
      const list = holder.__neo3Moves && holder.__neo3Moves[op.id];
      const spot = list && list[list.length - 1];
      if (!spot || spot.parent !== el.parentNode) return false;
      list!.pop();
      spot.parent.insertBefore(el, spot.next && spot.next.parentNode === spot.parent && spot.next !== el ? spot.next : null);
      return true;
    }

    switch (op.type) {
      case 'translate': {
        if (!finite(op.dx) || !finite(op.dy)) return false;
        if (svgGraphic(el)) {
          const raw = el.getAttribute('transform') || '';
          const match = /^\s*translate\(\s*(-?[\d.]+(?:e-?\d+)?)(?:[\s,]+(-?[\d.]+(?:e-?\d+)?))?\s*\)\s*/.exec(raw);
          const rest = match ? raw.slice(match[0].length) : raw.trim();
          const x = (match ? parseFloat(match[1]) : 0) + op.dx;
          const y = (match ? parseFloat(match[2] || '0') : 0) + op.dy;
          const zero = Math.abs(x) < 0.005 && Math.abs(y) < 0.005;
          const next = zero ? rest : 'translate(' + fmt(x) + ' ' + fmt(y) + ')' + (rest ? ' ' + rest : '');
          if (next.trim()) el.setAttribute('transform', next);
          else el.removeAttribute('transform');
          return true;
        }
        const current = (getProp(el, 'translate') || '').trim();
        let x = 0;
        let y = 0;
        if (current && current !== 'none') {
          const match = /^(-?[\d.]+(?:e-?\d+)?)px(?:\s+(-?[\d.]+(?:e-?\d+)?)px)?$/.exec(current);
          if (!match) return false;
          x = parseFloat(match[1]);
          y = parseFloat(match[2] || '0');
        }
        x += op.dx;
        y += op.dy;
        setProp(el, 'translate', Math.abs(x) < 0.005 && Math.abs(y) < 0.005 ? null : fmt(x) + 'px ' + fmt(y) + 'px');
        return true;
      }
      case 'resize': {
        if (!finite(op.width) || !finite(op.height)) return false;
        const width = fmt(Math.max(4, op.width));
        const height = fmt(Math.max(4, op.height));
        if (svgGraphic(el)) {
          if (SVG_SIZED.indexOf(el.localName.toLowerCase()) < 0) return false;
          el.setAttribute('width', width);
          el.setAttribute('height', height);
          return true;
        }
        setProp(el, 'width', width + 'px');
        setProp(el, 'height', height + 'px');
        return true;
      }
      case 'text': {
        if (typeof op.text !== 'string' || op.text.length > 100000 || !textOnly(el)) return false;
        el.textContent = op.text;
        return true;
      }
      case 'style': {
        if (PROPS.indexOf(op.prop) < 0 || (op.value !== null && !safeValue(op.value))) return false;
        setProp(el, op.prop, op.value === null || op.value.trim() === '' ? null : op.value.trim());
        return true;
      }
      case 'hide': {
        if (typeof op.hidden !== 'boolean') return false;
        if (op.hidden) setProp(el, 'display', 'none');
        else if ((getProp(el, 'display') || '').toLowerCase() === 'none') setProp(el, 'display', null);
        return true;
      }
      case 'remove': {
        if (protectedEl(el) || !el.parentNode) return false;
        stash()[op.id] = { node: el, parent: el.parentNode, next: el.nextSibling };
        el.parentNode.removeChild(el);
        return true;
      }
      case 'duplicate': {
        if (!validId(op.newId) || find(op.newId) || protectedEl(el) || !el.parentNode) return false;
        const copy = el.cloneNode(true) as Element;
        copy.setAttribute(ATTR, op.newId);
        const inner = copy.querySelectorAll('[' + ATTR + ']');
        for (let i = 0; i < inner.length; i += 1) inner[i].setAttribute(ATTR, op.newId + '.' + (i + 1));
        el.parentNode.insertBefore(copy, el.nextSibling);
        return true;
      }
      case 'layer': {
        if (op.dir !== 'up' && op.dir !== 'down') return false;
        const siblings = idSiblings(el);
        const parent = el.parentNode;
        if (!parent) return false;
        if (op.dir === 'up') {
          const next = siblings.filter((s) => el.compareDocumentPosition(s) & 4)[0];
          if (!next) return false;
          rememberSpot(el, op.id);
          parent.insertBefore(el, next.nextSibling);
        } else {
          const before = siblings.filter((s) => el.compareDocumentPosition(s) & 2);
          const prev = before[before.length - 1];
          if (!prev) return false;
          rememberSpot(el, op.id);
          parent.insertBefore(el, prev);
        }
        return true;
      }
      case 'reorder': {
        const parent = el.parentNode;
        if (!parent) return false;
        if (op.beforeId === null) {
          const siblings = idSiblings(el);
          const last = siblings[siblings.length - 1];
          rememberSpot(el, op.id);
          if (last && el.compareDocumentPosition(last) & 4) parent.insertBefore(el, last.nextSibling);
          return true;
        }
        const before = find(op.beforeId);
        if (!before || before === el || before.parentNode !== parent) return false;
        rememberSpot(el, op.id);
        parent.insertBefore(el, before);
        return true;
      }
      case 'attrs': {
        const attrs = op.attrs;
        if (!attrs || typeof attrs !== 'object') return false;
        const names = Object.keys(attrs);
        for (let i = 0; i < names.length; i += 1) {
          const value = (attrs as Record<string, unknown>)[names[i]];
          if (RESTORABLE.indexOf(names[i]) < 0 || (value !== null && (typeof value !== 'string' || value.length > 100000))) return false;
        }
        for (let i = 0; i < names.length; i += 1) {
          const value = (attrs as Record<string, string | null>)[names[i]];
          if (value === null) el.removeAttribute(names[i]);
          else el.setAttribute(names[i], value);
        }
        return true;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

const isSvgGraphic = (element: Element) => element.namespaceURI === SVG_NS && element.parentElement?.namespaceURI === SVG_NS;

/** The operation that undoes `op` — computed on the document BEFORE `op` is applied. */
export function inverseOp(doc: Document, op: EditorOp): EditorOp | null {
  if (op.type === 'frameOrder') {
    const elements = op.ids.map((id) => findById(doc, id));
    if (elements.some((element) => !element)) return null;
    const current = (elements as Element[]).slice().sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
    return { type: 'frameOrder', ids: current.map((element) => element.getAttribute(NEO3_ID_ATTR)!) };
  }
  if (op.type === 'unremove') return { type: 'remove', id: op.id };
  const element = findById(doc, op.id);
  if (!element) return null;
  const raw = (name: RestorableAttr) => element.getAttribute(name);
  switch (op.type) {
    case 'translate':
      return { type: 'attrs', id: op.id, attrs: isSvgGraphic(element) ? { transform: raw('transform') } : { style: raw('style') } };
    case 'resize':
      return { type: 'attrs', id: op.id, attrs: isSvgGraphic(element) ? { width: raw('width'), height: raw('height') } : { style: raw('style') } };
    case 'style':
    case 'hide':
      return { type: 'attrs', id: op.id, attrs: { style: raw('style') } };
    case 'text':
      return { type: 'text', id: op.id, text: element.textContent ?? '' };
    case 'remove':
      return { type: 'unremove', id: op.id };
    case 'duplicate':
      return { type: 'remove', id: op.newId };
    case 'layer':
    case 'reorder':
      return { type: 'unmove', id: op.id };
    case 'attrs': {
      const attrs: Partial<Record<RestorableAttr, string | null>> = {};
      for (const name of Object.keys(op.attrs) as RestorableAttr[]) attrs[name] = raw(name);
      return { type: 'attrs', id: op.id, attrs };
    }
    default:
      return null;
  }
}

/** A CSS selector of the element for the agent (no `data-neo3-id`: it is not in the file). */
export function cssPathFor(doc: Document, id: string): string | null {
  const element = findById(doc, id);
  const container = containerOf(doc);
  if (!element || !container) return null;
  const segments: string[] = [];
  for (let node: Element | null = element; node && node !== container; node = node.parentElement) {
    const htmlId = node.getAttribute('id');
    if (htmlId && /^[A-Za-z][\w-]*$/.test(htmlId) && doc.querySelectorAll(`#${htmlId}`).length === 1) {
      segments.unshift(`#${htmlId}`);
      return segments.join(' > ');
    }
    const tag = localTag(node);
    const parent: Element | null = node.parentElement;
    const sameTag = parent ? Array.from(parent.children).filter((child) => localTag(child) === tag) : [node];
    segments.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
  }
  if (element === container) return localTag(container);
  segments.unshift(localTag(container));
  return segments.join(' > ');
}

const collapsedText = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Where the element sits in the document and how its text starts — to find it again in a changed source. */
export function fingerprintFor(doc: Document, id: string): ElementFingerprint | null {
  const element = findById(doc, id);
  const container = containerOf(doc);
  if (!element || !container || !(element === container || container.contains(element))) return null;
  const segments: string[] = [];
  for (let node: Element = element; node !== container; node = node.parentElement!) {
    segments.unshift(`${localTag(node)}:${Array.from(node.parentElement!.children).indexOf(node)}`);
  }
  return { path: segments.join('/'), textStart: collapsedText(element) };
}

function findByFingerprint(doc: Document, fp: ElementFingerprint): Element | null {
  const container = containerOf(doc);
  if (!container) return null;
  let node: Element | null = container;
  for (const segment of fp.path ? fp.path.split('/') : []) {
    const [tag, index] = segment.split(':');
    const child: Element | undefined = node ? node.children[Number(index)] : undefined;
    node = child && localTag(child) === tag ? child : null;
    if (!node) break;
  }
  if (node && node.hasAttribute(NEO3_ID_ATTR) && collapsedText(node) === fp.textStart) return node;
  // The path moved (the agent added or removed something before it): a unique element with the same tag and text.
  const tag = fp.path.split('/').at(-1)?.split(':')[0];
  if (!tag || !fp.textStart) return null;
  const matches = Array.from(container.querySelectorAll(`[${NEO3_ID_ATTR}]`))
    .filter((candidate) => localTag(candidate) === tag && collapsedText(candidate) === fp.textStart);
  return matches.length === 1 ? matches[0] : null;
}

/** An id no element of the document has: for `duplicate`. */
export function freshElementId(doc: Document): string {
  let max = 0;
  for (const element of Array.from(doc.querySelectorAll(`[${NEO3_ID_ATTR}]`))) {
    const head = Number.parseInt(element.getAttribute(NEO3_ID_ATTR) ?? '', 10);
    if (Number.isFinite(head) && head > max) max = head;
  }
  return String(max + 1);
}

const relatedIds = (op: EditorOp): string[] => (
  op.type === 'reorder' && op.beforeId !== null ? [op.beforeId] : op.type === 'frameOrder' ? op.ids : []
);

/** Stack entry for `op` on the document as it is NOW (call before applying): inverse + fingerprints. */
export function createStackEntry(doc: Document, op: EditorOp): StackEntry | null {
  const inverse = inverseOp(doc, op);
  if (!inverse) return null;
  const mainId = op.type === 'frameOrder' ? null : op.id;
  const related: Record<string, ElementFingerprint | null> = {};
  for (const id of relatedIds(op)) related[id] = fingerprintFor(doc, id);
  return { op, inverse, fp: mainId ? fingerprintFor(doc, mainId) : null, ...(Object.keys(related).length ? { related } : {}) };
}

function remap(doc: Document, entry: StackEntry): EditorOp | null {
  const locate = (id: string, fp: ElementFingerprint | null | undefined): string | null => {
    const element = fp ? findByFingerprint(doc, fp) : findById(doc, id);
    return element?.getAttribute(NEO3_ID_ATTR) ?? null;
  };
  const { op } = entry;
  if (op.type === 'frameOrder') {
    const ids = op.ids.map((id) => locate(id, entry.related?.[id]));
    return ids.every((id): id is string => id !== null) ? { type: 'frameOrder', ids } : null;
  }
  if (op.type === 'unremove' || op.type === 'unmove' || op.type === 'attrs') return null;
  const id = locate(op.id, entry.fp);
  if (!id) return null;
  if (op.type === 'reorder' && op.beforeId !== null) {
    const beforeId = locate(op.beforeId, entry.related?.[op.beforeId]);
    return beforeId ? { ...op, id, beforeId } : null;
  }
  if (op.type === 'duplicate') return { ...op, id, newId: findById(doc, op.newId) ? freshElementId(doc) : op.newId };
  return { ...op, id };
}

/**
 * Replays the applied operations on a freshly instrumented new source (the
 * agent changed the file during the edit): each element is looked up by its
 * fingerprint; not found or not applicable — skipped and counted. `entries`
 * is the new stack content (inverses for the new document).
 */
export function replayOps(doc: Document, entries: StackEntry[]): { applied: number; skipped: number; entries: StackEntry[] } {
  let applied = 0;
  let skipped = 0;
  const next: StackEntry[] = [];
  for (const entry of entries) {
    const op = remap(doc, entry);
    const fresh = op ? createStackEntry(doc, op) : null;
    if (!op || !fresh || !applyOpToDocument(doc, op)) {
      skipped += 1;
      continue;
    }
    applied += 1;
    next.push(fresh);
  }
  return { applied, skipped, entries: next };
}

/** Undo/redo stack: up to `limit` applied entries, a new push drops the redo part. */
export function createOpStack(limit = 200): OpStack {
  let done: StackEntry[] = [];
  let undone: StackEntry[] = [];
  return {
    push(entry) {
      done.push(entry);
      if (done.length > limit) done = done.slice(done.length - limit);
      undone = [];
    },
    undo() {
      const entry = done.pop() ?? null;
      if (entry) undone.push(entry);
      return entry;
    },
    redo() {
      const entry = undone.pop() ?? null;
      if (entry) done.push(entry);
      return entry;
    },
    get canUndo() {
      return done.length > 0;
    },
    get canRedo() {
      return undone.length > 0;
    },
    entries() {
      return done.slice();
    },
    clear() {
      done = [];
      undone = [];
    },
  };
}

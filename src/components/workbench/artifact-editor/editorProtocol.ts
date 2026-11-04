/**
 * Сообщения моста правки (iframe ↔ холст).
 *
 * iframe — `sandbox="allow-scripts"` без same-origin, поэтому обе стороны
 * говорят через `postMessage(…, '*')` и проверяют: родитель — `event.source`
 * своего iframe и одноразовый ключ; мост — `event.source === window.parent` и
 * тот же ключ. Всё, что пришло из iframe, недоверенное: родитель пропускает
 * сообщение только через `validateBridgeMessage` и дальше работает с копией.
 */

import type { EditorOp } from './editorModel';
import type { Rect } from './snap';

export type ParentLayout = 'flex-row' | 'flex-col' | 'grid' | 'block';

export type ParentToBridge = { nonce: string } & (
  | { type: 'apply'; op: EditorOp }
  | { type: 'select'; ids: string[] }
  | { type: 'scrollTo'; id: string }
  | { type: 'snapshot'; id: string }
  | { type: 'editText'; id: string }
  | { type: 'setZoomHint'; zoom: number });

export type BridgeToParent = { nonce: string } & (
  | { type: 'ready'; width: number; height: number; frames: string[] }
  | { type: 'hover'; id: string | null; rect: Rect | null }
  | { type: 'pick'; id: string | null; shift: boolean } // id null = элемент без data-neo3-id (его нарисовал скрипт)
  | { type: 'rects'; items: { id: string; rect: Rect; parentLayout: ParentLayout; editableText: boolean }[] }
  | { type: 'siblings'; id: string; items: { id: string; rect: Rect }[] }
  | { type: 'textCommitted'; id: string; text: string }
  | { type: 'textCancelled'; id: string }
  | { type: 'snapshot'; id: string; dataUrl: string | null }
  | { type: 'scroll'; x: number; y: number }
  | { type: 'zoomWheel'; deltaY: number }); // Cmd/Ctrl+колесо над страницей — масштаб холста

const MAX_ITEMS = 5000;
const MAX_TEXT = 100_000;
const MAX_DATA_URL = 20_000_000;
const ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const PNG_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/;
const LAYOUTS: readonly string[] = ['flex-row', 'flex-col', 'grid', 'block'];

type Fields = Record<string, unknown>;

/** A plain object with exactly these keys. */
function exact(value: unknown, keys: readonly string[]): value is Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

const isId = (value: unknown): value is string => typeof value === 'string' && ID_RE.test(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e7;

function readRect(value: unknown): Rect | null {
  if (!exact(value, ['x', 'y', 'w', 'h'])) return null;
  const { x, y, w, h } = value;
  return isNumber(x) && isNumber(y) && isNumber(w) && isNumber(h) && w >= 0 && h >= 0 ? { x, y, w, h } : null;
}

function readList<T>(value: unknown, readItem: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = readItem(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

const KEYS: Record<BridgeToParent['type'], readonly string[]> = {
  ready: ['width', 'height', 'frames'],
  hover: ['id', 'rect'],
  pick: ['id', 'shift'],
  rects: ['items'],
  siblings: ['id', 'items'],
  textCommitted: ['id', 'text'],
  textCancelled: ['id'],
  snapshot: ['id', 'dataUrl'],
  scroll: ['x', 'y'],
  zoomWheel: ['deltaY'],
};

/**
 * A message from the bridge, checked field by field; null — refused (foreign
 * nonce, unknown type, extra or missing fields, wrong value types, over limits).
 * The result is a fresh plain object, never the one from the iframe.
 */
export function validateBridgeMessage(raw: unknown, nonce: string): BridgeToParent | null {
  if (!nonce || typeof raw !== 'object' || raw === null) return null;
  const type = (raw as Fields).type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(KEYS, type)) return null;
  const kind = type as BridgeToParent['type'];
  if (!exact(raw, ['nonce', 'type', ...KEYS[kind]]) || raw.nonce !== nonce) return null;
  const m = raw;
  switch (kind) {
    case 'ready': {
      const frames = readList(m.frames, (item) => (isId(item) ? item : null));
      return isNumber(m.width) && isNumber(m.height) && m.width >= 0 && m.height >= 0 && frames
        ? { nonce, type: kind, width: m.width, height: m.height, frames }
        : null;
    }
    case 'hover': {
      if (m.id !== null && !isId(m.id)) return null;
      const rect = m.rect === null ? null : readRect(m.rect);
      return m.rect !== null && !rect ? null : { nonce, type: kind, id: m.id, rect };
    }
    case 'pick':
      return (m.id === null || isId(m.id)) && typeof m.shift === 'boolean' ? { nonce, type: kind, id: m.id, shift: m.shift } : null;
    case 'rects': {
      const items = readList(m.items, (item) => {
        if (!exact(item, ['id', 'rect', 'parentLayout', 'editableText'])) return null;
        const rect = readRect(item.rect);
        if (!isId(item.id) || !rect || typeof item.parentLayout !== 'string' || !LAYOUTS.includes(item.parentLayout) || typeof item.editableText !== 'boolean') return null;
        return { id: item.id, rect, parentLayout: item.parentLayout as ParentLayout, editableText: item.editableText };
      });
      return items ? { nonce, type: kind, items } : null;
    }
    case 'siblings': {
      const items = readList(m.items, (item) => {
        if (!exact(item, ['id', 'rect'])) return null;
        const rect = readRect(item.rect);
        return isId(item.id) && rect ? { id: item.id, rect } : null;
      });
      return isId(m.id) && items ? { nonce, type: kind, id: m.id, items } : null;
    }
    case 'textCommitted':
      return isId(m.id) && typeof m.text === 'string' && m.text.length <= MAX_TEXT ? { nonce, type: kind, id: m.id, text: m.text } : null;
    case 'textCancelled':
      return isId(m.id) ? { nonce, type: kind, id: m.id } : null;
    case 'snapshot': {
      const ok = m.dataUrl === null || (typeof m.dataUrl === 'string' && m.dataUrl.length <= MAX_DATA_URL && PNG_DATA_URL_RE.test(m.dataUrl));
      return isId(m.id) && ok ? { nonce, type: kind, id: m.id, dataUrl: m.dataUrl as string | null } : null;
    }
    case 'scroll':
      return isNumber(m.x) && isNumber(m.y) ? { nonce, type: kind, x: m.x, y: m.y } : null;
    case 'zoomWheel':
      return isNumber(m.deltaY) ? { nonce, type: kind, deltaY: m.deltaY } : null;
    default:
      return null;
  }
}

/** One-time key of an editing session (16 random bytes, hex). */
export function createBridgeNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

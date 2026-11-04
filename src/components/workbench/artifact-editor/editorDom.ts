/**
 * Поиск по разобранной копии исходника (DOM есть только в браузере;
 * в node не тестируется — см. selftest).
 */

import { NEO3_ID_ATTR } from './editorModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NO_TEXT = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'script', 'style', 'template', 'iframe', 'canvas', 'video', 'audio', 'select', 'textarea', 'object', 'picture', 'svg', 'math', 'html', 'head', 'body']);
const SVG_TEXT = new Set(['text', 'tspan']);

export function findEditorElement(doc: Document, id: string): Element | null {
  return /^[A-Za-z0-9._:-]{1,200}$/.test(id) ? doc.querySelector(`[${NEO3_ID_ATTR}="${id}"]`) : null;
}

/** Only text inside: HTML (not void/replaced) or SVG `<text>`/`<tspan>`. */
export function textOnlyElement(element: Element): boolean {
  const tag = element.localName.toLowerCase();
  if (element.namespaceURI === SVG_NS ? !SVG_TEXT.has(tag) : NO_TEXT.has(tag)) return false;
  return Array.from(element.childNodes).every((node) => node.nodeType === 3);
}

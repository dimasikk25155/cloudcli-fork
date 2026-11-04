/**
 * Мост правки — инлайн `<script data-neo3-bridge>`, первый в `<head>` копии
 * документа (`previewHtml`). Живёт в iframe `sandbox="allow-scripts"` без
 * same-origin (CSP превью: `connect-src 'none'`), поэтому к cookies и API
 * Neo3 доступа не имеет.
 *
 * Слушает только `window.parent` с ключом сессии; всё, что шлёт, несёт тот же
 * ключ (родитель проверяет `event.source` своего iframe и `validateBridgeMessage`).
 * Клики и нажатия страницы перехватывает: в режиме правки ссылки и обработчики
 * страницы не срабатывают. Операции применяет той же `applyOpToDocument`, что
 * и родитель к разобранной копии исходника.
 */

import { applyOpToDocument } from './editorModel';
import { pickFrameSet } from './frames';

type ApplyFn = (doc: Document, op: unknown) => boolean;
type PickFrames = (candidates: { id: string; parentKey: string; rule: number }[]) => string[];
type BridgeRect = { x: number; y: number; w: number; h: number };
type Editing = { el: HTMLElement; id: string; original: string; hadAttr: string | null; onKey: (event: KeyboardEvent) => void; onBlur: () => void };

const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Runs inside the iframe. SELF-CONTAINED: no module names — `buildBridgeScript`
 * inlines its `toString()` with `applyOp` and `pickFrames` passed in.
 */
function bridgeRuntime(nonce: string, applyOp: ApplyFn, pickFrames: PickFrames): void {
  const ATTR = 'data-neo3-id';
  const SVG = 'http://www.w3.org/2000/svg';
  const NO_TEXT = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'script', 'style', 'template', 'iframe', 'canvas', 'video', 'audio', 'select', 'textarea', 'object', 'picture', 'svg', 'math', 'html', 'head', 'body'];
  const host = window.parent;
  if (!host || (host as unknown) === (window as unknown)) return;
  const own = document.currentScript;
  if (own && own.parentNode) own.parentNode.removeChild(own);

  let selection: string[] = [];
  let readySent = false;
  let rectsQueued = false;
  let scrollQueued = false;
  let hoverQueued = false;
  let hoverTarget: Element | null = null;
  let lastHover: Element | null | undefined;
  let editing: Editing | null = null;
  let zoomHint = 1;

  const send = (message: Record<string, unknown>) => {
    message.nonce = nonce;
    try {
      host.postMessage(message, '*');
    } catch {
      // the parent is gone
    }
  };
  const round = (value: number) => Math.round(value * 100) / 100;
  // Next frame, or 50 ms when frames do not run (a hidden tab or window).
  const nextFrame = (run: () => void) => {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      run();
    };
    requestAnimationFrame(once);
    setTimeout(once, 50);
  };
  const byId = (id: unknown): Element | null => {
    if (typeof id !== 'string' || !id) return null;
    const list = document.querySelectorAll('[' + ATTR + ']');
    for (let i = 0; i < list.length; i += 1) if (list[i].getAttribute(ATTR) === id) return list[i];
    return null;
  };
  // CSS pixels of the document (not the viewport, not scaled).
  const rectOf = (el: Element): BridgeRect => {
    const box = el.getBoundingClientRect();
    return { x: round(box.left + (window.scrollX || 0)), y: round(box.top + (window.scrollY || 0)), w: round(Math.max(0, box.width)), h: round(Math.max(0, box.height)) };
  };
  const layoutOf = (el: Element): string => {
    const parent = el.parentElement;
    if (!parent) return 'block';
    try {
      const style = getComputedStyle(parent);
      const display = String(style.display || '');
      if (display.indexOf('flex') >= 0) return String(style.flexDirection || '').indexOf('column') === 0 ? 'flex-col' : 'flex-row';
      if (display.indexOf('grid') >= 0) return 'grid';
    } catch {
      // detached
    }
    return 'block';
  };
  // Text is edited in place only in HTML elements whose children are all text.
  const editableText = (el: Element): boolean => {
    if (el.namespaceURI === SVG || NO_TEXT.indexOf(el.localName.toLowerCase()) >= 0) return false;
    for (let i = 0; i < el.childNodes.length; i += 1) if (el.childNodes[i].nodeType !== 3) return false;
    return true;
  };
  const sendRects = () => {
    rectsQueued = false;
    const items: Array<Record<string, unknown>> = [];
    for (let i = 0; i < selection.length; i += 1) {
      const el = byId(selection[i]);
      if (el) items.push({ id: selection[i], rect: rectOf(el), parentLayout: layoutOf(el), editableText: editableText(el) });
    }
    send({ type: 'rects', items });
  };
  const queueRects = () => {
    if (rectsQueued || selection.length === 0) return;
    rectsQueued = true;
    nextFrame(sendRects);
  };
  const sendSiblings = (id: string) => {
    const el = byId(id);
    const parent = el && el.parentElement;
    if (!el || !parent) return;
    const items: Array<Record<string, unknown>> = [];
    for (let i = 0; i < parent.children.length; i += 1) {
      const child = parent.children[i];
      const childId = child.getAttribute(ATTR);
      if (child !== el && childId) items.push({ id: childId, rect: rectOf(child) });
    }
    send({ type: 'siblings', id, items });
  };
  const sendReady = () => {
    if (readySent) return;
    readySent = true;
    const selectors = ['[data-slide]', '.slide', 'section'];
    const parents: unknown[] = [];
    const candidates: { id: string; parentKey: string; rule: number }[] = [];
    for (let rule = 0; rule < selectors.length; rule += 1) {
      const list = document.querySelectorAll(selectors[rule]);
      for (let i = 0; i < list.length; i += 1) {
        const id = list[i].getAttribute(ATTR);
        if (!id) continue;
        let key = parents.indexOf(list[i].parentNode);
        if (key < 0) key = parents.push(list[i].parentNode) - 1;
        candidates.push({ id, parentKey: 'p' + key, rule });
      }
    }
    const root = document.documentElement;
    send({ type: 'ready', width: round(root.scrollWidth || 0), height: round(root.scrollHeight || 0), frames: pickFrames(candidates) });
  };

  const elementOf = (target: EventTarget | null): Element | null => {
    let node = target as Node | null;
    while (node && node.nodeType !== 1) node = node.parentNode;
    return node as Element | null;
  };
  const pageRoot = (el: Element | null) => !el || el === document.documentElement || el === document.body;

  const finishEdit = (commit: boolean) => {
    const current = editing;
    if (!current) return;
    editing = null;
    const el = current.el;
    el.removeEventListener('keydown', current.onKey, true);
    el.removeEventListener('blur', current.onBlur, true);
    if (current.hadAttr === null) el.removeAttribute('contenteditable');
    else el.setAttribute('contenteditable', current.hadAttr);
    if (commit) {
      send({ type: 'textCommitted', id: current.id, text: el.textContent || '' });
    } else {
      el.textContent = current.original;
      send({ type: 'textCancelled', id: current.id });
    }
  };
  const startEdit = (id: unknown) => {
    if (editing) finishEdit(true);
    const el = byId(id) as HTMLElement | null;
    if (typeof id !== 'string') return;
    if (!el || !editableText(el)) {
      send({ type: 'textCancelled', id });
      return;
    }
    const hadAttr = el.getAttribute('contenteditable');
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        finishEdit(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finishEdit(false);
      }
    };
    const onBlur = () => finishEdit(true);
    editing = { el, id, original: el.textContent || '', hadAttr, onKey, onBlur };
    el.addEventListener('keydown', onKey, true);
    el.addEventListener('blur', onBlur, true);
    try {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const picked = window.getSelection();
      if (picked) {
        picked.removeAllRanges();
        picked.addRange(range);
      }
    } catch {
      // focus is best effort
    }
  };

  // Computed styles copied inline, so the clone looks the same inside foreignObject.
  const inlineStyles = (source: Element, target: Element, budget: { left: number }) => {
    if (budget.left <= 0) return;
    budget.left -= 1;
    try {
      const style = getComputedStyle(source);
      let css = '';
      for (let i = 0; i < style.length; i += 1) css += style[i] + ':' + style.getPropertyValue(style[i]) + ';';
      target.setAttribute('style', css);
    } catch {
      // keep the source style
    }
    target.removeAttribute(ATTR);
    for (let i = 0; i < source.children.length && i < target.children.length; i += 1) inlineStyles(source.children[i], target.children[i], budget);
  };
  // PNG of an element: HTML — a styled clone in SVG foreignObject; SVG — the outer svg whose viewBox is the element's box.
  // The image is always exactly the element (width × height CSS px) and drawn whole: drawImage(image, 0, 0, w, h)
  // — a source rectangle of an SVG image is read in device pixels by WebKit on DPR 2 and cut the picture.
  const snapshot = (id: unknown) => {
    if (typeof id !== 'string') return;
    let finished = false;
    const finish = (dataUrl: string | null) => {
      if (finished) return;
      finished = true;
      send({ type: 'snapshot', id, dataUrl });
    };
    const el = byId(id);
    if (!el) {
      finish(null);
      return;
    }
    try {
      const box = el.getBoundingClientRect();
      const width = Math.max(1, Math.ceil(box.width));
      const height = Math.max(1, Math.ceil(box.height));
      let markup: string;
      const graphic = el as SVGGraphicsElement;
      if (el.namespaceURI === SVG && graphic.ownerSVGElement) {
        let root = graphic.ownerSVGElement;
        while (root.ownerSVGElement) root = root.ownerSVGElement;
        // Client px → user units of the outer svg (its viewBox, aspect ratio and position included).
        const ctm = root.getScreenCTM();
        if (!ctm) {
          finish(null);
          return;
        }
        const inverse = ctm.inverse();
        const a = new DOMPoint(box.left, box.top).matrixTransform(inverse);
        const b = new DOMPoint(box.left + width, box.top + height).matrixTransform(inverse);
        const copy = root.cloneNode(true) as Element;
        copy.setAttribute('xmlns', SVG);
        copy.setAttribute('viewBox', [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x) || 1, Math.abs(b.y - a.y) || 1].join(' '));
        copy.setAttribute('preserveAspectRatio', 'none');
        copy.setAttribute('width', String(width));
        copy.setAttribute('height', String(height));
        copy.setAttribute('style', (copy.getAttribute('style') || '') + ';margin:0;padding:0;border:0;translate:none;transform:none;width:' + width + 'px;height:' + height + 'px;');
        markup = new XMLSerializer().serializeToString(copy);
      } else {
        const copy = el.cloneNode(true) as Element;
        inlineStyles(el, copy, { left: 3000 });
        copy.setAttribute('style', (copy.getAttribute('style') || '') + 'margin:0;translate:none;');
        markup = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject x="0" y="0" width="100%" height="100%">'
          + new XMLSerializer().serializeToString(copy) + '</foreignObject></svg>';
      }
      const image = new Image();
      setTimeout(() => finish(null), 5000);
      image.onload = () => {
        try {
          const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1, zoomHint));
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(4096, Math.round(width * scale));
          canvas.height = Math.min(4096, Math.round(height * scale));
          const context = canvas.getContext('2d');
          if (!context) {
            finish(null);
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/png'));
        } catch {
          // a tainted canvas (external pictures) — no snapshot
          finish(null);
        }
      };
      image.onerror = () => finish(null);
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    } catch {
      finish(null);
    }
  };

  const block = (event: Event) => {
    if (editing && editing.el.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  const blocked = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick', 'submit', 'dragstart'];
  for (let i = 0; i < blocked.length; i += 1) document.addEventListener(blocked[i], block, true);
  document.addEventListener('click', (event: MouseEvent) => {
    if (editing && editing.el.contains(event.target as Node)) return;
    if (editing) finishEdit(true);
    block(event);
    const el = elementOf(event.target);
    if (pageRoot(el)) return;
    send({ type: 'pick', id: el!.getAttribute(ATTR), shift: !!event.shiftKey });
  }, true);
  const flushHover = () => {
    hoverQueued = false;
    if (hoverTarget === lastHover) return;
    lastHover = hoverTarget;
    send({ type: 'hover', id: hoverTarget ? hoverTarget.getAttribute(ATTR) : null, rect: hoverTarget ? rectOf(hoverTarget) : null });
  };
  document.addEventListener('mousemove', (event: MouseEvent) => {
    if (editing) return;
    const el = elementOf(event.target);
    hoverTarget = pageRoot(el) ? null : el;
    if (!hoverQueued) {
      hoverQueued = true;
      nextFrame(flushHover);
    }
  }, true);
  document.addEventListener('mouseleave', () => {
    hoverTarget = null;
    flushHover();
  }, true);

  window.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    nextFrame(() => {
      scrollQueued = false;
      send({ type: 'scroll', x: round(window.scrollX || 0), y: round(window.scrollY || 0) });
      queueRects();
    });
  }, { passive: true });
  // Cmd/Ctrl+wheel (a trackpad pinch too) zooms the canvas, not the page.
  window.addEventListener('wheel', (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    if (isFinite(delta) && delta !== 0) send({ type: 'zoomWheel', deltaY: round(delta) });
  }, { passive: false });
  window.addEventListener('resize', queueRects);
  if (typeof ResizeObserver === 'function') new ResizeObserver(queueRects).observe(document.documentElement);
  if (typeof MutationObserver === 'function') {
    new MutationObserver(queueRects).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== host) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || data.nonce !== nonce || typeof data.type !== 'string') return;
    switch (data.type) {
      case 'apply':
        if (applyOp(document, data.op)) queueRects();
        break;
      case 'select':
        if (Array.isArray(data.ids) && data.ids.length <= 5000) {
          selection = data.ids.filter((id): id is string => typeof id === 'string');
          sendRects();
          if (selection.length === 1) sendSiblings(selection[0]);
        }
        break;
      case 'scrollTo': {
        const el = byId(data.id);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
        break;
      }
      case 'snapshot':
        snapshot(data.id);
        break;
      case 'editText':
        startEdit(data.id);
        break;
      case 'setZoomHint':
        if (typeof data.zoom === 'number' && isFinite(data.zoom) && data.zoom > 0) zoomHint = Math.min(4, Math.max(0.25, data.zoom));
        break;
      default:
        break;
    }
  });

  if (document.readyState === 'complete') sendReady();
  else {
    window.addEventListener('load', sendReady);
    setTimeout(sendReady, 3000);
  }
}

/** `</script` and `<!--` must not appear raw inside an inline script. */
const escapeInlineScript = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/**
 * The bridge as an inline `<script data-neo3-bridge>…</script>` for the start
 * of `<head>` of the copy. `nonce` — `createBridgeNonce()` of the session.
 * `__name` is defined for builds that wrap nested functions with it (esbuild keepNames).
 */
export function buildBridgeScript(nonce: string): string {
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) throw new Error('Ключ моста должен быть случайной строкой 16–128 символов');
  const code = '(function(){"use strict";var __name=function(fn){return fn;};'
    + 'var applyOp=(' + applyOpToDocument.toString() + ');'
    + 'var pickFrames=(' + pickFrameSet.toString() + ');'
    + '(' + bridgeRuntime.toString() + ')(' + JSON.stringify(nonce) + ',applyOp,pickFrames);})();';
  return '<script data-neo3-bridge>' + escapeInlineScript(code) + '</script>';
}

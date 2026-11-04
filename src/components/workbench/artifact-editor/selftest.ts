/**
 * Самопроверка DOM-части редактора в настоящем браузере (в node DOM нет).
 * Открывается из клиента по `?neo3EditorSelfTest=1` (`src/main.jsx`) и рисует
 * поверх страницы список PASS/FAIL; результаты — ещё в `window.__neo3EditorSelfTest`
 * и в заголовке вкладки («PASS 14/14 — …»).
 */

import { buildBridgeScript } from './bridge';
import {
  applyOpToDocument,
  createStackEntry,
  cssPathFor,
  instrumentSource,
  NEO3_ID_ATTR,
  previewHtml,
  replayOps,
  serializeDocument,
  type EditorDocKind,
  type EditorOp,
  type StackEntry,
} from './editorModel';
import { createBridgeNonce } from './editorProtocol';
import { findFrames } from './frames';

export type SelfTestResult = { name: string; ok: boolean; detail: string };

const STYLE_BLOCK = `<style>
  .card > h1 { color: #222; } /* a < b && c */
</style>`;
const SCRIPT_BLOCK = `<script>
  if (1 < 2 && "</div>".length) { window.x = '<b>&amp;</b>'; }
</script>`;

const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
${STYLE_BLOCK}
${SCRIPT_BLOCK}
</head>
<body>
<main class="card" style="padding:8px">
  <h1 id="title">Заголовок</h1>
  <p>Первый абзац</p>
  <p>Второй <b>жирный</b> абзац</p>
  <div class="row" style="display:flex">
    <span>A</span><span>B</span><span>C</span>
  </div>
</main>
<script src="app.js"></script>
</body>
</html>
`;
// Ids by traversal: main 1, h1 2, p 3, p 4, b 5, div 6, span 7 (A), 8 (B), 9 (C).

const DECK = `<!DOCTYPE html><html><head></head><body><div class="deck">
<section class="slide">1</section>
<section class="slide">2</section>
<section class="slide">3</section>
</div></body></html>`;
// div 1, sections 2, 3, 4.

const PICTURE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">
  <style>.t { font: 12px sans-serif; }</style>
  <rect x="10" y="10" width="50" height="30" fill="#0af"/>
  <g transform="rotate(5)"><circle cx="100" cy="50" r="20"/></g>
  <text x="10" y="90" class="t">Подпись</text>
</svg>
`;
// svg 1, rect 2, g 3, circle 4, text 5.

class Check extends Error {}
function expect(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Check(detail);
}
const includes = (text: string, part: string, what: string) => expect(text.includes(part), `${what}: нет «${part}»`);
const lacks = (text: string, part: string, what: string) => expect(!text.includes(part), `${what}: лишнее «${part}»`);

function edited(source: string, kind: EditorDocKind, ops: EditorOp[]): string {
  const { doc } = instrumentSource(source, kind);
  for (const op of ops) expect(applyOpToDocument(doc, op), `операция не применилась: ${JSON.stringify(op)}`);
  return serializeDocument(doc, kind);
}

/** Apply `op` and its inverse: the file must come back byte for byte. */
function undoesExactly(source: string, kind: EditorDocKind, op: EditorOp): void {
  const { doc } = instrumentSource(source, kind);
  const before = serializeDocument(doc, kind);
  const entry = createStackEntry(doc, op);
  expect(entry, `нет обратной операции для ${op.type}`);
  expect(applyOpToDocument(doc, op), `${op.type} не применилась`);
  expect(serializeDocument(doc, kind) !== before, `${op.type} ничего не изменила`);
  expect(applyOpToDocument(doc, entry.inverse), `обратная к ${op.type} не применилась`);
  const after = serializeDocument(doc, kind);
  expect(after === before, `${op.type}: после отмены файл другой:\n${after}`);
}

const CASES: Array<[string, () => void]> = [
  ['разбор: id по порядку обхода, скрипты и стили без id', () => {
    const { doc, count } = instrumentSource(PAGE, 'html');
    expect(count === 9, `элементов ${count}, ждали 9`);
    expect(doc.querySelector('h1')?.getAttribute(NEO3_ID_ATTR) === '2', 'h1 не получил id 2');
    expect(doc.querySelectorAll(`script[${NEO3_ID_ATTR}], style[${NEO3_ID_ATTR}], head [${NEO3_ID_ATTR}]`).length === 0, 'id попал в script/style/head');
    const ids = Array.from(doc.querySelectorAll(`[${NEO3_ID_ATTR}]`)).map((el) => el.getAttribute(NEO3_ID_ATTR));
    expect(ids.join(',') === '1,2,3,4,5,6,7,8,9', `порядок id: ${ids.join(',')}`);
  }],
  ['сохранение без правок: нет следов редактора, <script>/<style> байт в байт', () => {
    const out = edited(PAGE, 'html', []);
    lacks(out, NEO3_ID_ATTR, 'файл');
    lacks(out, 'data-neo3-bridge', 'файл');
    includes(out, STYLE_BLOCK, 'стиль');
    includes(out, SCRIPT_BLOCK, 'скрипт');
    includes(out, '<script src="app.js"></script>', 'внешний скрипт');
    expect(out.startsWith('<!doctype html>\n<html lang="ru">'), `начало файла: ${out.slice(0, 40)}`);
    expect(out.endsWith('\n'), 'потерян перевод строки в конце');
    expect(out === PAGE, 'сохранение без правок изменило файл');
    expect(edited(out, 'html', []) === out, 'повторное сохранение меняет файл');
    const fragment = '<h1>Только кусок</h1>\n<p>без html и body</p>\n';
    expect(edited(fragment, 'html', []) === fragment, `кусок разметки обернулся: ${edited(fragment, 'html', [])}`);
    const tricky = '<!DOCTYPE html><html><head><script>var s = "<body class=x>";</script></head><body class="real"><p>a</p></body></html>';
    expect(edited(tricky, 'html', []) === tricky, `«<body» в строке скрипта сбил разбор: ${edited(tricky, 'html', [])}`);
  }],
  ['операции HTML: сдвиг, размер, текст, цвет, скрыть, слой, порядок', () => {
    includes(edited(PAGE, 'html', [{ type: 'translate', id: '2', dx: 10, dy: 5 }]), '<h1 id="title" style="translate: 10px 5px;">Заголовок</h1>', 'сдвиг');
    includes(edited(PAGE, 'html', [{ type: 'resize', id: '3', width: 120, height: 40 }]), '<p style="width: 120px; height: 40px;">Первый абзац</p>', 'размер');
    includes(edited(PAGE, 'html', [{ type: 'text', id: '3', text: 'Новый <текст>' }]), '<p>Новый &lt;текст&gt;</p>', 'текст');
    includes(edited(PAGE, 'html', [{ type: 'style', id: '1', prop: 'color', value: '#ff0000' }]), '<main class="card" style="padding:8px; color: #ff0000;">', 'цвет');
    includes(edited(PAGE, 'html', [{ type: 'style', id: '1', prop: 'color', value: '#ff0000' }, { type: 'style', id: '1', prop: 'color', value: null }]), '<main class="card" style="padding:8px;">', 'убрать цвет');
    includes(edited(PAGE, 'html', [{ type: 'hide', id: '8', hidden: true }]), '<span style="display: none;">B</span>', 'скрыть');
    includes(edited(PAGE, 'html', [{ type: 'layer', id: '7', dir: 'up' }]), '<span>B</span><span>A</span><span>C</span>', 'слой выше');
    includes(edited(PAGE, 'html', [{ type: 'reorder', id: '9', beforeId: '7' }]), '<span>C</span><span>A</span><span>B</span>', 'порядок');
    includes(edited(PAGE, 'html', [{ type: 'reorder', id: '7', beforeId: null }]), '<span>B</span><span>C</span><span>A</span>', 'в конец');
    const { doc } = instrumentSource(PAGE, 'html');
    expect(!applyOpToDocument(doc, { type: 'text', id: '4', text: 'x' }), 'текст заменился у элемента с вложенным <b>');
    expect(!applyOpToDocument(doc, { type: 'layer', id: '7', dir: 'down' }), 'первый элемент ушёл ниже');
    expect(!applyOpToDocument(doc, { type: 'remove', id: 'нет' }), 'удалён несуществующий');
  }],
  ['удалить и дублировать', () => {
    const removed = edited(PAGE, 'html', [{ type: 'remove', id: '9' }]);
    includes(removed, '<span>A</span><span>B</span>\n  </div>', 'удаление');
    const { doc } = instrumentSource(PAGE, 'html');
    expect(applyOpToDocument(doc, { type: 'duplicate', id: '4', newId: '100' }), 'дубль не создан');
    expect(doc.querySelector(`[${NEO3_ID_ATTR}="100"] b`)?.getAttribute(NEO3_ID_ATTR) === '100.1', 'потомок копии без id 100.1');
    expect(!applyOpToDocument(doc, { type: 'duplicate', id: '4', newId: '100' }), 'повтор id копии принят');
    includes(serializeDocument(doc, 'html'), '<p>Второй <b>жирный</b> абзац</p><p>Второй <b>жирный</b> абзац</p>\n  <div', 'дубль');
  }],
  ['отмена каждой операции возвращает файл байт в байт', () => {
    const ops: EditorOp[] = [
      { type: 'translate', id: '2', dx: 10, dy: 5 },
      { type: 'resize', id: '1', width: 300, height: 200 },
      { type: 'text', id: '3', text: 'Новый' },
      { type: 'style', id: '1', prop: 'background-color', value: 'yellow' },
      { type: 'hide', id: '8', hidden: true },
      { type: 'remove', id: '4' },
      { type: 'remove', id: '9' },
      { type: 'duplicate', id: '3', newId: '50' },
      { type: 'layer', id: '2', dir: 'up' },
      { type: 'layer', id: '6', dir: 'down' },
      { type: 'reorder', id: '6', beforeId: '2' },
      { type: 'reorder', id: '2', beforeId: null },
    ];
    for (const op of ops) undoesExactly(PAGE, 'html', op);
    undoesExactly(DECK, 'html', { type: 'frameOrder', ids: ['4', '2', '3'] });
    undoesExactly(PICTURE, 'svg', { type: 'translate', id: '2', dx: 3, dy: 4 });
    undoesExactly(PICTURE, 'svg', { type: 'translate', id: '3', dx: 3, dy: 4 });
    undoesExactly(PICTURE, 'svg', { type: 'resize', id: '2', width: 80, height: 40 });
    undoesExactly(PICTURE, 'svg', { type: 'style', id: '2', prop: 'fill', value: '#f00' });
  }],
  ['стек: после правок <script>/<style> страницы не тронуты', () => {
    const out = edited(PAGE, 'html', [
      { type: 'style', id: '1', prop: 'font-family', value: 'Georgia, serif' },
      { type: 'translate', id: '2', dx: 4, dy: 4 },
      { type: 'remove', id: '4' },
      { type: 'reorder', id: '9', beforeId: '7' },
    ]);
    includes(out, STYLE_BLOCK, 'стиль');
    includes(out, SCRIPT_BLOCK, 'скрипт');
    lacks(out, NEO3_ID_ATTR, 'файл');
  }],
  ['кадры слайдов: поиск и новый порядок', () => {
    const { doc } = instrumentSource(DECK, 'html');
    const frames = findFrames(doc);
    expect(frames.join(',') === '2,3,4', `кадры: ${frames.join(',')}`);
    expect(applyOpToDocument(doc, { type: 'frameOrder', ids: ['4', '2', '3'] }), 'порядок кадров не применился');
    includes(serializeDocument(doc, 'html'), '<section class="slide">3</section>\n<section class="slide">1</section>\n<section class="slide">2</section>', 'порядок кадров');
    expect(findFrames(instrumentSource(PAGE, 'html').doc).length === 0, 'у обычной страницы нашлись кадры');
  }],
  ['SVG: сдвиг, размер, заливка, текст; без id, объявление XML на месте', () => {
    const { doc, count } = instrumentSource(PICTURE, 'svg');
    expect(count === 5, `элементов SVG ${count}, ждали 5`);
    const ops: EditorOp[] = [
      { type: 'translate', id: '2', dx: 5, dy: 6 },
      { type: 'resize', id: '2', width: 80, height: 40 },
      { type: 'style', id: '2', prop: 'fill', value: '#f00' },
      { type: 'text', id: '5', text: 'Новая подпись' },
    ];
    for (const op of ops) expect(applyOpToDocument(doc, op), `SVG ${op.type} не применилась`);
    expect(!applyOpToDocument(doc, { type: 'resize', id: '4', width: 10, height: 10 }), 'размер круга принят');
    const out = serializeDocument(doc, 'svg');
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg'), `начало SVG: ${out.slice(0, 60)}`);
    lacks(out, NEO3_ID_ATTR, 'SVG');
    expect(/<rect x="10" y="10" width="80" height="40" fill="#0af" transform="translate\(5 6\)" style="fill: #f00;"\s?\/>/.test(out), `rect: ${out}`);
    includes(out, '>Новая подпись</text>', 'текст SVG');
    includes(out, '<style>.t { font: 12px sans-serif; }</style>', 'стиль SVG');
  }],
  ['превью: мост первым в <head>, id на месте; файл без моста', () => {
    const nonce = createBridgeNonce();
    const { doc } = instrumentSource(PAGE, 'html');
    const html = previewHtml(doc, 'html', buildBridgeScript(nonce));
    expect(/<head><script data-neo3-bridge>/.test(html), 'мост не первый в <head>');
    includes(html, `${NEO3_ID_ATTR}="2"`, 'превью');
    includes(html, JSON.stringify(nonce), 'превью');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.head.firstElementChild?.hasAttribute('data-neo3-bridge'), 'разбор превью: мост не первый');
    lacks(serializeDocument(doc, 'html'), 'data-neo3-bridge', 'файл после превью');
    const svg = instrumentSource(PICTURE, 'svg').doc;
    const svgHtml = previewHtml(svg, 'svg', buildBridgeScript(nonce));
    expect(svgHtml.startsWith('<!DOCTYPE html><html><head><script data-neo3-bridge>'), 'SVG-превью без обёртки');
    includes(svgHtml, `${NEO3_ID_ATTR}="2"`, 'SVG-превью');
  }],
  ['переигрывание правок на изменённом агентом файле — по отпечаткам', () => {
    const { doc } = instrumentSource(PAGE, 'html');
    const ops: EditorOp[] = [
      { type: 'text', id: '2', text: 'Новый заголовок' },
      { type: 'style', id: '3', prop: 'color', value: 'red' },
      { type: 'remove', id: '9' },
    ];
    const entries: StackEntry[] = [];
    for (const op of ops) {
      const entry = createStackEntry(doc, op);
      expect(entry && applyOpToDocument(doc, op), `${op.type} не записалась`);
      entries.push(entry);
    }
    const changed = PAGE.replace('<main class="card" style="padding:8px">\n', '<main class="card" style="padding:8px">\n  <p>Вставил агент</p>\n')
      .replace('<span>C</span>', '');
    const fresh = instrumentSource(changed, 'html').doc;
    const result = replayOps(fresh, entries);
    expect(result.applied === 2 && result.skipped === 1, `применено ${result.applied}, пропущено ${result.skipped}`);
    expect(result.entries.length === 2, 'новый стек не собран');
    const out = serializeDocument(fresh, 'html');
    includes(out, '<h1 id="title">Новый заголовок</h1>', 'заголовок');
    includes(out, '<p style="color: red;">Первый абзац</p>', 'абзац');
    includes(out, '<p>Вставил агент</p>', 'правка агента');
  }],
  ['CSS-путь для агента', () => {
    const { doc } = instrumentSource(PAGE, 'html');
    expect(cssPathFor(doc, '2') === '#title', `h1: ${cssPathFor(doc, '2')}`);
    expect(cssPathFor(doc, '8') === 'body > main > div > span:nth-of-type(2)', `span: ${cssPathFor(doc, '8')}`);
    expect(cssPathFor(doc, '404') === null, 'путь у несуществующего');
  }],
  ['applyOpToDocument самодостаточна: из её текста работает так же', () => {
    const rebuilt = new Function('__name', `return (${applyOpToDocument.toString()});`)((fn: unknown) => fn) as typeof applyOpToDocument;
    const ops: EditorOp[] = [
      { type: 'translate', id: '2', dx: 7, dy: 1 },
      { type: 'duplicate', id: '3', newId: '70' },
      { type: 'reorder', id: '9', beforeId: '7' },
      { type: 'hide', id: '8', hidden: true },
    ];
    const viaRebuilt = instrumentSource(PAGE, 'html').doc;
    for (const op of ops) expect(rebuilt(viaRebuilt, op), `копия функции: ${op.type} не применилась`);
    expect(serializeDocument(viaRebuilt, 'html') === edited(PAGE, 'html', ops), 'копия функции даёт другой результат');
  }],
];

/** Runs every check; a throw is a FAIL with its message. */
export function runEditorSelfTest(): SelfTestResult[] {
  return CASES.map(([name, run]) => {
    try {
      run();
      return { name, ok: true, detail: '' };
    } catch (error) {
      return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** Draws the PASS/FAIL list over the page (plain DOM, text only). */
export function mountEditorSelfTest(target: HTMLElement = document.body): SelfTestResult[] {
  const results = runEditorSelfTest();
  const passed = results.filter((result) => result.ok).length;
  const allOk = passed === results.length;
  (window as unknown as { __neo3EditorSelfTest?: SelfTestResult[] }).__neo3EditorSelfTest = results;
  document.title = `${allOk ? 'PASS' : 'FAIL'} ${passed}/${results.length} — самопроверка редактора`;
  const box = document.createElement('div');
  box.setAttribute('data-neo3-selftest', allOk ? 'pass' : 'fail');
  box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:24px;background:#fff;color:#111;font:14px/1.5 system-ui,sans-serif');
  const title = document.createElement('h1');
  title.setAttribute('style', `margin:0 0 16px;font-size:20px;color:${allOk ? '#0a7a2f' : '#b00020'}`);
  title.textContent = `Самопроверка редактора: ${allOk ? 'PASS' : 'FAIL'} — ${passed} из ${results.length}`;
  box.appendChild(title);
  for (const result of results) {
    const row = document.createElement('div');
    row.setAttribute('style', 'margin:6px 0;white-space:pre-wrap');
    const mark = document.createElement('strong');
    mark.setAttribute('style', `color:${result.ok ? '#0a7a2f' : '#b00020'}`);
    mark.textContent = result.ok ? 'PASS ' : 'FAIL ';
    row.appendChild(mark);
    row.appendChild(document.createTextNode(result.ok ? result.name : `${result.name} — ${result.detail}`));
    box.appendChild(row);
  }
  target.appendChild(box);
  return results;
}

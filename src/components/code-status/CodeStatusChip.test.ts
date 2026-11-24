import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Окно «Где мой код» ставится `position: fixed` по координатам кнопки от окна
// браузера. Шапка чата — лист стекла (`.glass-sheet`): размытие делает её
// опорой для фиксированных потомков, и окно, нарисованное внутри шапки,
// уезжало на ширину шторки вправо (компьютер) и вниз (приложение с домашнего
// экрана). Окно обязано рисоваться в `body`.
// Компонент под node не развернуть (портал, эффекты, запрос статуса) — тест
// читает исходники.

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('окно «Где мой код» рисуется порталом в body, а не внутри шапки-стекла', () => {
  const header = read('../main-content/view/subcomponents/MainContentHeader.tsx');
  assert.match(header, /className="[^"]*\bglass-sheet\b[^"]*"/, 'шапка чата — лист стекла');
  assert.match(header, /<CodeStatusChip /, 'чип стоит в шапке чата');

  const chip = read('./CodeStatusChip.tsx');
  // Координаты считаются от окна браузера — значит, и опорой должен быть он.
  assert.match(chip, /position: 'fixed', top: rect\.bottom \+ 6, left, width/);
  assert.match(chip, /import \{ createPortal \} from 'react-dom';/);
  const panel = chip.match(/\{open &&\s*createPortal\(\s*<div([\s\S]*?)>[\s\S]*?<\/div>,\s*document\.body,?\s*\)\}/);
  assert.ok(panel, 'окно не уходит порталом в document.body');
  assert.match(panel[1], /role="dialog"/);
  assert.match(panel[1], /aria-label="Где мой код"/);
  assert.match(panel[1], /style=\{panelStyle\}/);
  // Клик внутри окна не закрывает его: портал не меняет проверку по ref.
  assert.match(chip, /panelRef\.current\?\.contains\(target\)/);
});

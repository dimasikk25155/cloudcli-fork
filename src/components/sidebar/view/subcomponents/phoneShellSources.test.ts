import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// «Домой» и шторка берут стекло только готовыми классами (`.glass-*` из
// index.css) и цвета только из значений темы. Тест читает исходники: ручное
// размытие и классы палитры — это то, из-за чего темы выглядели одинаково.

const COMPONENTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const sourcesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sourcesIn(file);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [file] : [];
  });

const relative = (file: string) => path.relative(COMPONENTS, file);

test('в «Домой», шторке и нижней панели нет ручного размытия', () => {
  const files = ['home', 'sidebar', 'bottom-bar'].flatMap((folder) => sourcesIn(path.join(COMPONENTS, folder)));
  assert.ok(files.length > 20, 'исходники найдены');
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /backdrop-blur|backdrop-filter|backdropFilter/, relative(file));
  }
});

test('в настройках и быстрых настройках нет ручного размытия — только классы стекла', () => {
  // Ревью ветки (история 9, DESIGN.md §6): затемнение за окном настроек,
  // липкая сцена тонкой настройки и «кусочек стекла» на карточке темы писали
  // размытие сами — мимо запасных веток классов стекла.
  const files = ['settings', 'quick-settings-panel'].flatMap((folder) => sourcesIn(path.join(COMPONENTS, folder)));
  assert.ok(files.length > 30, 'исходники найдены');
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /backdrop-blur|backdrop-filter|backdropFilter/, relative(file));
  }
  const read = (file: string) => readFileSync(path.join(COMPONENTS, file), 'utf8');
  // Затемнение за окном настроек — то же, что за шторкой и за Dialog.
  assert.match(read('settings/view/Settings.tsx'), /className="modal-backdrop glass-scrim fixed inset-0 /);
  // Сцена тонкой настройки липнет поверх ползунков — плотный лист стекла.
  assert.match(read('settings/view/tabs/ThemeTweakPanel.tsx'), /className="glass-sheet glass-dense sticky top-0 /);
  // «Кусочек стекла» на карточке темы — настоящий класс стекла на значениях
  // той темы, которую показывает карточка (вложенный data-theme).
  assert.match(read('settings/view/tabs/ThemePicker.tsx'), /className="glass-surface /);
});

test('оверлей и корпус шторки телефона — затемнение темы и лист стекла', () => {
  const source = readFileSync(path.join(COMPONENTS, 'app/AppContent.tsx'), 'utf8');
  assert.doesNotMatch(source, /backdrop-blur|bg-background\/60/);
  assert.match(source, /className="glass-scrim fixed inset-0/);
  assert.match(source, /app-sidebar glass-sheet /);
});

const PALETTE = /(?:^|[\s"'`:])(?:bg|text|border|ring|from|to|via|divide|fill|stroke)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose|white|black)(?:-\d{2,3})?(?:\/\d+)?(?=[\s"'`]|$)/m;

test('SidebarContent и SidebarModals: только значения темы — ни палитры, ни пар dark:', () => {
  for (const name of ['SidebarContent.tsx', 'SidebarModals.tsx']) {
    const source = readFileSync(path.join(COMPONENTS, 'sidebar/view/subcomponents', name), 'utf8');
    assert.doesNotMatch(source, PALETTE, name);
    assert.doesNotMatch(source, /\bdark:/, name);
  }
});

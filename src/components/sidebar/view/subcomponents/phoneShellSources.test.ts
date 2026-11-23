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

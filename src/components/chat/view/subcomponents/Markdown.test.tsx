import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// Bundle the real renderer for node; isolate unrelated theme and palette services.
// The highlighter's published ESM styles are browser-only, not part of these cases.
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'neo3-markdown-click-'));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'));
await build({
  stdin: { contents: `export { Markdown } from './src/components/chat/view/subcomponents/Markdown.tsx'; export { opened } from 'test-palette';`, resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', packages: 'external',
  tsconfigRaw: { compilerOptions: { jsx: 'react' } }, jsx: 'transform', jsxFactory: 'React.createElement', outfile: path.join(temporary, 'renderer.mjs'),
  plugins: [{ name: 'test-services', setup(builder) {
    builder.onResolve({ filter: /PaletteOpsContext$|^test-palette$/ }, () => ({ path: 'palette', namespace: 'test' }));
    builder.onResolve({ filter: /ThemeContext$/ }, () => ({ path: 'theme', namespace: 'test' }));
    builder.onResolve({ filter: /react-syntax-highlighter\/dist\/esm\/styles\/prism$/ }, () => ({ path: 'styles', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: name }) => ({ contents:
      name === 'palette' ? 'export const opened = []; export const usePaletteOps = () => ({ openFileInEditor: path => opened.push(path) });' :
      name === 'theme' ? 'export const useTheme = () => ({ isDarkMode: false });' :
      'export const oneDark = {}; export const oneLight = {};'
    }));
  } }],
});
const { Markdown, opened } = await import(pathToFileURL(path.join(temporary, 'renderer.mjs')).href);

type Clickable = { href?: string; title?: string; onClick?: (event: { preventDefault(): void }) => void };
function renderAndClick(markdown: string) {
  opened.length = 0;
  const links: Clickable[] = [];
  const createElement = React.createElement;
  const capture = mock.method(React, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'a' || (type === 'code' && props?.role === 'button')) links.push(props);
    return createElement(type, props, ...children);
  });
  try {
    const html = renderToStaticMarkup(<Markdown>{markdown}</Markdown>);
    const link = links.find((item) => item.onClick) ?? links[0];
    assert.ok(link, 'Markdown renders a link');
    let prevented = false;
    link.onClick?.({ preventDefault() { prevented = true; } });
    return { opened: [...opened], link, html, prevented };
  } finally {
    capture.mock.restore();
  }
}

test('Markdown click decodes the screenshot path before opening the file', () => {
  const path = '/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork/.autopilot/2026-11-02-improvement-ideas--wip/file-preview-result.md';
  const result = renderAndClick(`[Результат](<${path}>)`);
  assert.match(result.link.href!, /Antigravity%20Project/);
  assert.equal(result.prevented, true);
  assert.deepEqual(result.opened, [path]);
});

test('Markdown file URLs decode Unicode and percent signs exactly once', () => {
  for (const [target, expected] of [
    ['./Мои документы/отчёт.html:12:3', './Мои документы/отчёт.html'],
    ['/tmp/literal%20name.md', '/tmp/literal%20name.md'],
    ['/tmp/literal%25name.md', '/tmp/literal%25name.md'],
    ['/tmp/100%.md', '/tmp/100%.md'],
  ]) {
    const result = renderAndClick(`[file](<${encodeURI(target)}>)`);
    assert.deepEqual(result.opened, [expected]);
  }
});

test('Malformed escapes do not throw, and raw path text is not URL decoded', () => {
  assert.deepEqual(renderAndClick('[file](/tmp/bad%E0%A4.md)').opened, ['/tmp/bad%E0%A4.md']);
  assert.deepEqual(renderAndClick('[/tmp/raw%20name.md]()').opened, ['/tmp/raw%20name.md']);
  assert.deepEqual(renderAndClick('`/tmp/raw%20name.md`').opened, ['/tmp/raw%20name.md']);
});

test('External links retain browser navigation and URL encoding', () => {
  const target = 'https://example.com/Antigravity%20Project/report.html';
  const result = renderAndClick(`[website](${target})`);
  assert.equal(result.link.href, target);
  assert.equal(result.prevented, false);
  assert.deepEqual(result.opened, []);
});

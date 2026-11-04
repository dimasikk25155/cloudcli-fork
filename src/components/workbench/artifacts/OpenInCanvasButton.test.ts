import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isCanvasFile } from '../../../../shared/artifacts.js';

const { default: OpenInCanvasButton } = await import('./OpenInCanvasButton.js');

const render = (filePath: string) => renderToStaticMarkup(React.createElement(OpenInCanvasButton, { filePath }));

test('«Открыть в холсте» is shown next to links to pages, documents, PDF and pictures only', () => {
  for (const file of ['/p/report.html', 'docs/brief.md', 'out/deck.pdf', 'shots/a.png', 'logo.svg', 'docs/plan.md:12']) {
    assert.match(render(file), /data-open-in-canvas/, file);
    assert.equal(isCanvasFile(file), true, file);
  }
  for (const file of ['server/index.js', 'src/App.tsx', 'package.json', '']) {
    assert.equal(render(file), '', file);
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CodeEditorHtmlPreview from '../view/subcomponents/CodeEditorHtmlPreview';
import CodeEditorHeader from '../view/subcomponents/CodeEditorHeader';

import { defaultDocumentPreview } from './documentPreview';

test('HTML opens rendered, Markdown stays rendered, code and diff stay editable', () => {
  assert.equal(defaultDocumentPreview({ name: 'Сайт.HTML' }), 'html');
  assert.equal(defaultDocumentPreview({ name: 'index.htm' }), 'html');
  assert.equal(defaultDocumentPreview({ name: 'readme.md' }), 'markdown');
  assert.equal(defaultDocumentPreview({ name: 'index.html', diffInfo: {} }), 'code');
  assert.equal(defaultDocumentPreview({ name: 'app.ts' }), 'code');
});
test('HTML surface embeds a scoped URL with opaque origin and exposes errors/retry', () => {
  const props = { name: 'index.html', url: '/api/file-preview/test/index.html', error: null, onRetry() {}, hasRootReferences: false };
  const markup = renderToStaticMarkup(React.createElement(CodeEditorHtmlPreview, props));
  assert.match(markup, /src="\/api\/file-preview\/test\/index.html"/);
  assert.match(markup, /sandbox="allow-scripts"/);
  assert.doesNotMatch(markup, /allow-same-origin|srcDoc/);
  assert.match(renderToStaticMarkup(React.createElement(CodeEditorHtmlPreview, { ...props, url: null })), /Открываем страницу/);
  const failed = renderToStaticMarkup(React.createElement(CodeEditorHtmlPreview, { ...props, error: 'Файл не найден' }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Повторить/);
  assert.doesNotMatch(failed, /<iframe/);
  assert.match(renderToStaticMarkup(React.createElement(CodeEditorHtmlPreview, { ...props, hasRootReferences: true })), /адреса от корня сайта/);
});
test('HTML header has visible code and new-tab controls', () => {
  const noop = () => {};
  const labels = Object.fromEntries(['showingChanges','editMarkdown','previewMarkdown','previewHtml','settings','download','save','saving','saved','fullscreen','exitFullscreen','close'].map(k => [k, k])) as Parameters<typeof CodeEditorHeader>[0]['labels'];
  const html = renderToStaticMarkup(React.createElement(CodeEditorHeader, {
    file: { name: 'index.html', path: 'index.html' }, isSidebar: false, isFullscreen: false, isMarkdownFile: false,
    isHtmlPreviewFile: true, markdownPreview: false, htmlPreview: true, htmlPreviewReady: true, saving: false, saveSuccess: false,
    onToggleMarkdownPreview: noop, onOpenHtmlPreview: noop, onToggleHtmlPreview: noop, onOpenSettings: noop,
    onCopyContent: noop, copySuccess: false, onDownload: noop, onSave: noop, onToggleFullscreen: noop, onClose: noop, labels,
  }));
  assert.match(html, />Код<\/button>/);
  assert.match(html, /В новой вкладке/);
});

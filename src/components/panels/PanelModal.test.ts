import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Wallet } from 'lucide-react';

import PanelModal from './PanelModal';
import { Dialog, DialogContent, DialogTitle } from '../../shared/view/ui';

// Dialog portals into document.body, which the server renderer cannot do.
// Unwrap it into plain markup and inline the plain function components, so
// the test sees the same tree the browser gets and can reach the handlers.
type AnyElement = React.ReactElement<Record<string, unknown>>;

function inline(node: React.ReactNode): React.ReactNode {
  if (Array.isArray(node)) return node.map(inline);
  if (!React.isValidElement(node)) return node;
  const element = node as AnyElement;
  const { children, ...rest } = element.props as { children?: React.ReactNode; className?: string };
  if (element.type === Dialog) return inline(children);
  if (element.type === DialogTitle) return null;
  if (element.type === DialogContent) {
    return React.createElement('div', { role: 'dialog', className: rest.className }, inline(children));
  }
  if (typeof element.type === 'function') {
    return inline((element.type as (props: unknown) => React.ReactNode)(element.props));
  }
  if (typeof element.type === 'string') {
    return React.createElement(element.type, { ...rest, key: element.key }, inline(children));
  }
  return element;
}

function findAll(node: React.ReactNode, match: (element: AnyElement) => boolean, found: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, match, found));
    return found;
  }
  if (!React.isValidElement(node)) return found;
  const element = node as AnyElement;
  if (match(element)) found.push(element);
  findAll((element.props as { children?: React.ReactNode }).children, match, found);
  return found;
}

const panel = (onClose: () => void) =>
  inline(PanelModal({ title: 'Канцелярия', icon: Wallet, onClose, children: React.createElement('p', null, 'тело') }));

test('phone header: a «Назад» arrow on the left closes the panel, hidden from md up', () => {
  const onClose = () => {};
  const tree = panel(onClose);
  const back = findAll(tree, (el) => el.type === 'button' && el.props['aria-label'] === 'Назад');
  assert.equal(back.length, 1, 'exactly one back button');
  assert.equal(back[0].props.onClick, onClose, 'back calls onClose');
  assert.match(String(back[0].props.className), /(^|\s)md:hidden(\s|$)/);

  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, tree));
  const backAt = html.indexOf('aria-label="Назад"');
  const titleAt = html.indexOf('>Канцелярия</h2>');
  const closeAt = html.indexOf('aria-label="Закрыть"');
  assert.ok(backAt > -1 && titleAt > backAt, 'back sits before (left of) the title');
  assert.ok(closeAt > titleAt, 'the cross stays on the right');
});

test('header clears the notch and the body clears the home indicator', () => {
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, panel(() => {})));
  const header = html.match(/<div class="([^"]*)"[^>]*data-panel-header/);
  assert.ok(header, 'header is marked');
  assert.match(header[1], /pt-\[max\([^\]]*env\(safe-area-inset-top\)\)\]/);
  // The bottom inset is --safe-bottom (env minus the strip the PWA window
  // does not cover, index.css), and none while the keyboard is up.
  const body = html.match(/<div class="([^"]*)"><p>тело<\/p>/);
  assert.ok(body, 'body wraps the content');
  assert.match(body[1], /(^|\s)pb-\[var\(--safe-bottom\)\](\s|$)/);
  assert.match(body[1], /\[\.keyboard-open_&(amp;)?\]:pb-0/);
  assert.doesNotMatch(body[1], /env\(safe-area-inset-bottom\)/);
});

test('one bottom inset: panels inside PanelModal do not add the home-indicator inset again', () => {
  // Review 23.11: the «All projects» folder and Крабик's input bar padded
  // for env(safe-area-inset-bottom) on top of PanelModal — ~34 px extra.
  for (const file of ['../home/HomeAllProjectsFolder.tsx', '../krabik/KrabikPanel.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /safe-area-inset-bottom|--safe-bottom/, file);
  }
});

test('«Назад» is a 44 px touch target on a phone, the visible box stays 36 px', () => {
  const tree = panel(() => {});
  const [back] = findAll(tree, (el) => el.type === 'button' && el.props['aria-label'] === 'Назад');
  const classes = String(back.props.className);
  assert.match(classes, /(^|\s)h-9 w-9(\s|$)/, 'visible 36 px');
  // An invisible ::before 4 px out on every side: 36 + 2 × 4 = 44.
  assert.match(classes, /(^|\s)relative(\s|$)/);
  assert.match(classes, /(^|\s)before:absolute(\s|$)/);
  assert.match(classes, /(^|\s)before:-inset-1(\s|$)/);
});

test('шапка панели — лист стекла, «Назад» — круглая стеклянная кнопка, под шапкой материал темы', () => {
  const tree = panel(() => {});
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, tree));
  const header = html.match(/<div class="([^"]*)"[^>]*data-panel-header/);
  assert.ok(header, 'header is marked');
  assert.match(header[1], /(^|\s)glass-sheet(\s|$)/);
  assert.match(header[1], /(^|\s)pwa-panel-header(\s|$)/);
  const [back] = findAll(tree, (el) => el.type === 'button' && el.props['aria-label'] === 'Назад');
  assert.match(String(back.props.className), /(^|\s)glass-button(\s|$)/);
  // Панель на весь экран показывает материал темы, а не ровную заливку фоном:
  // иначе во всех темах она отличается только оттенком серого (разбор, P1).
  const dialog = html.match(/<div role="dialog" class="([^"]*)"/);
  assert.ok(dialog);
  assert.match(dialog[1], /(^|\s)theme-surface(\s|$)/);
  assert.doesNotMatch(dialog[1], /(^|\s)bg-background(\s|$)/);
  const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
  assert.match(css, /\.theme-surface\s*\{[^}]*background-color:\s*var\(--shell-bg\);[^}]*background-image:\s*var\(--shell-material\)/);
});

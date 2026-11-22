import assert from 'node:assert/strict';
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
  assert.match(html, /<div class="[^"]*pb-\[env\(safe-area-inset-bottom\)\][^"]*"><p>тело<\/p>/);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SettingsHeader from './SettingsHeader';

type AnyElement = React.ReactElement<Record<string, unknown>>;

// Inline plain function components so the handlers are reachable.
function inline(node: React.ReactNode): React.ReactNode {
  if (Array.isArray(node)) return node.map(inline);
  if (!React.isValidElement(node)) return node;
  const element = node as AnyElement;
  const { children, ...rest } = element.props as { children?: React.ReactNode };
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

test('settings header: «Назад» on the left closes the window on a phone', () => {
  const onClose = () => {};
  const tree = inline(React.createElement(SettingsHeader, { title: 'Настройки', onClose }));
  const back = findAll(tree, (el) => el.type === 'button' && el.props['aria-label'] === 'Назад');
  assert.equal(back.length, 1);
  assert.equal(back[0].props.onClick, onClose);
  assert.match(String(back[0].props.className), /(^|\s)md:hidden(\s|$)/);

  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, tree));
  assert.ok(html.indexOf('aria-label="Назад"') < html.indexOf('>Настройки</h2>'), 'arrow left of the title');
  assert.match(html, /aria-label="Закрыть"/, 'desktop cross kept');
});

test('settings header shows the saved note when given', () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsHeader, { title: 'Настройки', onClose: () => {}, savedText: 'Сохранено' }),
  );
  assert.match(html, />Сохранено</);
});

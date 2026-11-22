import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';

import type { ProjectSortOrder } from '../../types/types';

import ProjectSortToggle from './ProjectSortToggle';

const RU: Record<string, string> = {
  'projectSort.label': 'Порядок проектов',
  'projectSort.recent': 'Сначала недавние',
  'projectSort.name': 'По алфавиту',
};
const t = ((key: string, fallback?: string) => RU[key] ?? fallback ?? key) as unknown as TFunction;

type AnyElement = React.ReactElement<Record<string, unknown>>;

function buttonsOf(order: ProjectSortOrder, onChange: (order: ProjectSortOrder) => void): AnyElement[] {
  const root = ProjectSortToggle({ order, onChange, t }) as AnyElement;
  const found: AnyElement[] = [];
  const walk = (node: React.ReactNode) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!React.isValidElement(node)) return;
    const element = node as AnyElement;
    if (element.type === 'button') found.push(element);
    walk((element.props as { children?: React.ReactNode }).children);
  };
  walk(root);
  return found;
}

test('two choices «Сначала недавние» / «По алфавиту», the current one pressed', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectSortToggle, { order: 'recent', onChange: () => {}, t }));
  assert.match(html, /role="group"[^>]*aria-label="Порядок проектов"|aria-label="Порядок проектов"[^>]*role="group"/);
  assert.match(html, /aria-label="Сначала недавние"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Сначала недавние"/);
  assert.match(html, /aria-label="По алфавиту"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="По алфавиту"/);
  assert.match(html, />А–Я</);

  const byName = renderToStaticMarkup(React.createElement(ProjectSortToggle, { order: 'name', onChange: () => {}, t }));
  assert.match(byName, /aria-label="По алфавиту"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="По алфавиту"/);
});

test('pressing a choice reports that order', () => {
  const picked: ProjectSortOrder[] = [];
  const [recent, name] = buttonsOf('recent', (order) => picked.push(order));
  (name.props.onClick as () => void)();
  (recent.props.onClick as () => void)();
  assert.deepEqual(picked, ['name', 'recent']);
});

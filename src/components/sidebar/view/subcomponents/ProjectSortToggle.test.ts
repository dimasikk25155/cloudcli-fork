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

test('on a phone each choice is a 44 px touch target, the pill stays 24 px tall', () => {
  // Review 23.11: the segments were 24 px — under Apple's 44 px minimum. The
  // visible pill keeps h-6; an invisible ::before reaches 10 px up and down
  // (24 + 2 × 10 = 44) and 12 px outward — left of the clock, right of А–Я —
  // so the two areas never overlap each other (each segment is ≥ 28 px wide).
  const [recent, name] = buttonsOf('recent', () => {});
  for (const button of [recent, name]) {
    const classes = String(button.props.className);
    assert.match(classes, /(^|\s)h-6(\s|$)/);
    assert.match(classes, /(^|\s)min-w-\[1\.75rem\](\s|$)/);
    assert.match(classes, /(^|\s)relative(\s|$)/);
    assert.match(classes, /(^|\s)max-md:before:absolute(\s|$)/);
    assert.match(classes, /(^|\s)max-md:before:-inset-y-2\.5(\s|$)/);
  }
  const recentClasses = String(recent.props.className);
  const nameClasses = String(name.props.className);
  assert.match(recentClasses, /(^|\s)max-md:before:-left-3(\s|$)/);
  assert.match(recentClasses, /(^|\s)max-md:before:right-0(\s|$)/);
  assert.match(nameClasses, /(^|\s)max-md:before:left-0(\s|$)/);
  assert.match(nameClasses, /(^|\s)max-md:before:-right-3(\s|$)/);
});

test('on a phone the touch areas stay off the neighbours («Недавние N», ⚡N)', () => {
  // Review of task 04: the left area reached 16 px out and covered the end of
  // «Недавние N». On the phone the switch sits after a 12 px gap (`gap-3` of
  // the tab row and of the right cluster in SidebarHeader) plus the pill's
  // 2 px padding — an outward reach within the 12 px gap never covers them.
  const PHONE_GAP_PX = 12;
  const [recent, name] = buttonsOf('recent', () => {});
  const reach = (classes: string, side: 'left' | 'right'): number => {
    const found = classes.match(new RegExp(`(?:^|\\s)max-md:before:-${side}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`));
    return found ? Number(found[1]) * 4 : 0;
  };
  const left = reach(String(recent.props.className), 'left');
  const right = reach(String(name.props.className), 'right');
  assert.ok(left > 0 && right > 0, 'both outer sides still reach outward');
  assert.ok(left <= PHONE_GAP_PX, `left reach ${left} px`);
  assert.ok(right <= PHONE_GAP_PX, `right reach ${right} px`);
});

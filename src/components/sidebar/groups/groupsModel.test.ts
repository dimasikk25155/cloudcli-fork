import assert from 'node:assert/strict';
import test from 'node:test';

import type { SidebarGroupsTree } from '../../../../shared/sidebar-groups';

import { arrangeProjects, groupOfProject, moveGroup, pinnedFirst } from './groupsModel';

const tree: SidebarGroupsTree = {
  groups: [
    { id: 'g1', name: 'Клиенты', collapsed: false, items: [{ type: 'project', id: 'b' }, { type: 'project', id: 'gone' }, { type: 'session', id: 's1' }] },
    { id: 'g2', name: 'Пусто', collapsed: true, items: [] },
  ],
  pins: ['s3', 's1'],
};

test('projects are laid out by group, unknown members are skipped, the rest goes last', () => {
  const sections = arrangeProjects([{ projectId: 'a' }, { projectId: 'b' }, { projectId: 'c' }], tree);
  assert.deepEqual(sections.map((section) => [section.group?.id ?? null, section.projects.map((project) => project.projectId)]), [
    ['g1', ['b']],
    ['g2', []],
    [null, ['a', 'c']],
  ]);
  assert.equal(groupOfProject(tree, 'b'), 'g1');
  assert.equal(groupOfProject(tree, 'a'), null);
});

test('pinned chats go first in pin order; without pins the list is untouched', () => {
  const sessions = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }];
  assert.deepEqual(pinnedFirst(sessions, tree.pins).map((s) => s.id), ['s3', 's1', 's2', 's4']);
  assert.equal(pinnedFirst(sessions, []), sessions);
  assert.deepEqual(pinnedFirst(sessions, ['nope']).map((s) => s.id), ['s1', 's2', 's3', 's4']);
});

test('moving a group swaps neighbours and stops at the edges', () => {
  assert.deepEqual(moveGroup(tree, 'g1', 1), ['g2', 'g1']);
  assert.deepEqual(moveGroup(tree, 'g1', -1), ['g1', 'g2']);
});

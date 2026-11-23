import assert from 'node:assert/strict';
import test from 'node:test';

import { sortAdminProjects } from './projectOrder';

const item = (customProjectName: string | null, path: string) => ({
  projectId: path,
  path,
  customProjectName,
});

test('sortAdminProjects orders by shown label, case-insensitive, Latin before Cyrillic', () => {
  const sorted = sortAdminProjects([
    item('wisper', '/p/wisper'),
    item('Эко Ротанг', '/p/eko'),
    item('bulls', '/p/bulls'),
    item(null, '/p/aaa'),
    item('Alhamdulillah', '/p/alh'),
    item('Договоры Еврострой', '/p/dog'),
    item('CC Moto', '/p/cc'),
  ]);

  assert.deepEqual(sorted.map((p) => p.customProjectName || p.path), [
    '/p/aaa',
    'Alhamdulillah',
    'bulls',
    'CC Moto',
    'wisper',
    'Договоры Еврострой',
    'Эко Ротанг',
  ]);
});

test('sortAdminProjects keeps equal labels apart by path and does not mutate input', () => {
  const input = [item('project', '/b/project'), item('project', '/a/project')];
  const sorted = sortAdminProjects(input);
  assert.deepEqual(sorted.map((p) => p.path), ['/a/project', '/b/project']);
  assert.equal(input[0].path, '/b/project');
});

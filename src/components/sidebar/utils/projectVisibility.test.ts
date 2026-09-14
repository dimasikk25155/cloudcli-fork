import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app.js';

import {
  isCodexInboxProject,
  isScratchProject,
  partitionCodexInboxProjects,
  sortProjects,
} from './utils.js';

const projectAt = (path: string, extras: Partial<Project> = {}): Project => ({
  projectId: extras.projectId ?? path,
  displayName: extras.displayName ?? path.split('/').pop() ?? path,
  fullPath: path,
  path,
  ...extras,
});

test('Codex desktop folders are inbox projects, real workspaces are not', () => {
  assert.equal(
    isCodexInboxProject(projectAt('/Users/dimasik/Documents/Codex/2026-09-11/new-chat')),
    true,
  );
  assert.equal(
    isCodexInboxProject(projectAt('/Users/dimasik/Documents/ChatGPT/Samruk Шина')),
    true,
  );
  assert.equal(
    isCodexInboxProject(projectAt('/Users/dimasik/Antigravity Project/Tyres')),
    false,
  );
  assert.equal(
    isCodexInboxProject(projectAt('/Users/dimasik/Antigravity Project')),
    false,
  );
});

test('scratch still hides tmp/repro/probe folders', () => {
  assert.equal(isScratchProject(projectAt('/tmp/speedtest')), true);
  assert.equal(isScratchProject(projectAt('/private/tmp/agtest')), true);
  assert.equal(
    isScratchProject(projectAt('/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork/.repro-tmp/project')),
    true,
  );
  assert.equal(isScratchProject(projectAt('/Users/dimasik/Antigravity Project/Tyres')), false);
});

test('sortProjects keeps Codex inbox below real workspaces unless starred', () => {
  const tyres = projectAt('/Users/dimasik/Antigravity Project/Tyres', { displayName: 'Tyres KZ' });
  const generate = projectAt('/Users/dimasik/Antigravity Project/generate', { displayName: 'generate' });
  const newChat = projectAt('/Users/dimasik/Documents/Codex/2026-09-11/new-chat', { displayName: 'new-chat' });
  const samruk = projectAt('/Users/dimasik/Documents/ChatGPT/Samruk Шина', {
    displayName: 'Samruk Шина',
    isStarred: true,
  });

  const sorted = sortProjects([newChat, tyres, samruk, generate], 'name');
  const names = sorted.map((project) => project.displayName);
  assert.equal(names[0], 'Samruk Шина');
  assert.equal(names[names.length - 1], 'new-chat');
  assert.ok(names.indexOf('Tyres KZ') < names.indexOf('new-chat'));
  assert.ok(names.indexOf('generate') < names.indexOf('new-chat'));
});

test('partitionCodexInboxProjects splits the list without dropping rows', () => {
  const tyres = projectAt('/Users/dimasik/Antigravity Project/Tyres', { displayName: 'Tyres KZ' });
  const newChat = projectAt('/Users/dimasik/Documents/Codex/2026-09-08/new-chat', { displayName: 'new-chat' });
  const { workspaceProjects, codexInboxProjects } = partitionCodexInboxProjects([tyres, newChat]);

  assert.deepEqual(workspaceProjects.map((project) => project.displayName), ['Tyres KZ']);
  assert.deepEqual(codexInboxProjects.map((project) => project.displayName), ['new-chat']);
});

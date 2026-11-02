import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { codexHome, resolveBundledCodex } from '@/shared/codex-paths.js';

import { CodexMcpProvider } from '../list/codex/codex-mcp.provider.js';
import { CodexProviderModels } from '../list/codex/codex-models.provider.js';
import { CodexSkillsProvider } from '../list/codex/codex-skills.provider.js';

test('custom CODEX_HOME is shared by models, settings, MCP and skills', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(root, 'custom');
  t.mock.method(os, 'homedir', () => path.join(root, 'default'));
  try {
    await mkdir(codexHome());
    await writeFile(path.join(codexHome(), 'models_cache.json'), JSON.stringify({ models: [
      { slug: 'gpt-99-sol', visibility: 'list', default_reasoning_level: 'persistent', supported_reasoning_levels: [{ effort: 'high' }, { effort: 'persistent' }] },
    ] }));
    await writeFile(path.join(codexHome(), 'config.toml'), 'model = "gpt-99-sol"\n');
    const models = new CodexProviderModels();
    assert.equal((await models.getSupportedModels()).DEFAULT, 'gpt-99-sol');
    assert.equal((await models.getSupportedModels()).OPTIONS[1].effort?.default, 'persistent');
    assert.equal((await models.getCurrentActiveModel()).model, 'gpt-99-sol');
    await new CodexMcpProvider().upsertServer({ name: 'fixture', scope: 'user', transport: 'stdio', command: 'fixture' });
    assert.match(await readFile(path.join(codexHome(), 'config.toml'), 'utf8'), /mcp_servers/);
    const skill = path.join(codexHome(), 'skills', 'fixture');
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, 'SKILL.md'), '---\nname: fixture\ndescription: Fixture skill\n---\nFixture.');
    assert.equal((await new CodexSkillsProvider().listSkills({ workspacePath: root })).some(s => s.name === 'fixture'), true);
    delete process.env.CODEX_HOME;
    assert.equal(codexHome(), path.join(root, 'default', '.codex'));
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('native CLI comes from the pinned SDK dependency independently of PATH', () => {
  const cli = resolveBundledCodex();
  assert.match(cli.executablePath, /node_modules/);
  assert.match(cli.executablePath, /codex(?:\.exe)?$/);
});

test('skills are discovered in every repository ancestor, without escaping the root', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-skill-ancestors-'));
  t.mock.method(os, 'homedir', () => path.join(root, 'home'));
  try {
    const repo = path.join(root, 'repo');
    const workspace = path.join(repo, 'a', 'b', 'c', 'd');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await mkdir(workspace, { recursive: true });
    for (const [dir, name] of [[path.join(repo, 'a'), 'middle'], [root, 'outside']]) {
      const folder = path.join(dir, '.agents', 'skills', name);
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: Fixture\n---\nFixture.`);
    }
    const skills = await new CodexSkillsProvider().listSkills({ workspacePath: workspace });
    assert.equal(skills.some(s => s.name === 'middle'), true);
    assert.equal(skills.some(s => s.name === 'outside'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

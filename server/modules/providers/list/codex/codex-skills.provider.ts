import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findTopmostGitRoot,
} from '@/shared/utils.js';

export class CodexSkillsProvider extends SkillsProvider {
  constructor() {
    super('codex');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();
    const repoRoot = await findTopmostGitRoot(workspacePath);

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'repo',
      rootDir: path.join(workspacePath, '.agents', 'skills'),
      commandPrefix: '$',
    });

    if (repoRoot) {
      // Codex checks repository skills at the launch folder, one folder above it,
      // and the topmost git root; these can collapse to the same directory.
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'repo',
        rootDir: path.join(path.dirname(workspacePath), '.agents', 'skills'),
        commandPrefix: '$',
      });
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'repo',
        rootDir: path.join(repoRoot, '.agents', 'skills'),
        commandPrefix: '$',
      });
    }

    // Codex App / CLI stores the user's skill library next to its config.
    // Direct children of this folder are user skills; `.system` is a nested
    // directory without SKILL.md at that level, so the non-recursive scanner
    // does not pick the bundled set up as user skills.
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.codex', 'skills'),
      commandPrefix: '$',
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.agents', 'skills'),
      commandPrefix: '$',
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'admin',
      rootDir: path.join('/etc', 'codex', 'skills'),
      commandPrefix: '$',
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'system',
      rootDir: path.join(os.homedir(), '.codex', 'skills', '.system'),
      commandPrefix: '$',
    });

    return sources;
  }

  /**
   * Where "Add Skill" writes.
   *
   * Codex App already keeps the 56-skill library in ~/.codex/skills (mirrors
   * Claude Code). Writing to ~/.agents/skills hid new skills from both the
   * Codex tab and the app.
   */
  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.codex', 'skills'),
      commandPrefix: '$',
    };
  }
}

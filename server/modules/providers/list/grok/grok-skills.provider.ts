import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findTopmostGitRoot,
  getGrokHome,
} from '@/shared/utils.js';

const GROK_PROJECT_SKILL_DIRS = [
  ['.grok', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

const GROK_SHARED_USER_SKILL_DIRS = [
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

/**
 * Skills for Grok Build.
 *
 * Verified with `grok inspect` on this box: Grok's harness compatibility layer
 * loads Claude's skill library wholesale — 122 skills came back tagged
 * `user [claude]`, including plugin skills (doop, vercel). So the shelf shown
 * in the UI is not an approximation: these are the exact folders the CLI reads.
 * Its own bundled set lives under ~/.grok/bundled/skills.
 */
export class GrokSkillsProvider extends SkillsProvider {
  constructor() {
    super('grok');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();
    const repoRoot = await findTopmostGitRoot(workspacePath);

    for (const projectRoot of this.getProjectSearchRoots(workspacePath, repoRoot)) {
      for (const skillDir of GROK_PROJECT_SKILL_DIRS) {
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'project',
          rootDir: path.join(projectRoot, ...skillDir),
          commandPrefix: '/',
        });
      }
    }

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(getGrokHome(), 'skills'),
      commandPrefix: '/',
    });

    for (const skillDir of GROK_SHARED_USER_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir: path.join(os.homedir(), ...skillDir),
        commandPrefix: '/',
      });
    }

    // Skills that ship with the CLI itself.
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'system',
      rootDir: path.join(getGrokHome(), 'bundled', 'skills'),
      commandPrefix: '/',
    });

    return sources;
  }

  /**
   * Where "create skill" writes.
   *
   * Deliberately Claude's library and not ~/.grok/skills: Grok reads both, the
   * user's 58 skills already live there, and a skill created from the Grok tab
   * should be visible to every engine instead of starting a second shelf that
   * only one CLI knows about. Without this override the base class refuses the
   * write outright (PROVIDER_SKILLS_WRITE_UNSUPPORTED), which is what Grok did
   * until now, and the path hint in the UI promised a folder we never wrote to.
   */
  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.claude', 'skills'),
      commandPrefix: '/',
    };
  }

  private getProjectSearchRoots(workspacePath: string, repoRoot: string | null): string[] {
    const roots: string[] = [];
    const normalizedRepoRoot = repoRoot ? path.resolve(repoRoot) : null;
    let currentPath = path.resolve(workspacePath);

    while (true) {
      roots.push(currentPath);
      if (!normalizedRepoRoot || currentPath === normalizedRepoRoot) {
        break;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }

      currentPath = parentPath;
    }

    return roots;
  }
}

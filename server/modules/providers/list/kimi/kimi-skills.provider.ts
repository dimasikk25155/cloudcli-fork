import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findTopmostGitRoot,
} from '@/shared/utils.js';
import { getKimiCodeHome } from '@/shared/utils.js';

const KIMI_PROJECT_SKILL_DIRS = [
  ['.kimi', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

const KIMI_USER_SKILL_DIR = 'skills';

const KIMI_SHARED_USER_SKILL_DIRS = [
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

export class KimiSkillsProvider extends SkillsProvider {
  constructor() {
    super('kimi');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();
    const repoRoot = await findTopmostGitRoot(workspacePath);

    for (const projectRoot of this.getProjectSearchRoots(workspacePath, repoRoot)) {
      for (const skillDir of KIMI_PROJECT_SKILL_DIRS) {
        // Kimi Code intentionally reads Claude and Agents skill folders so
        // users can reuse the same skill libraries across coding agents.
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'project',
          rootDir: path.join(projectRoot, ...skillDir),
          commandPrefix: '/',
        });
      }
    }

    // Kimi-specific user skills live under $KIMI_CODE_HOME/skills (they move
    // with KIMI_CODE_HOME); the generic shared ones stay under the OS home.
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(getKimiCodeHome(), KIMI_USER_SKILL_DIR),
      commandPrefix: '/',
    });

    for (const skillDir of KIMI_SHARED_USER_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir: path.join(os.homedir(), ...skillDir),
        commandPrefix: '/',
      });
    }

    return sources;
  }

  private getProjectSearchRoots(workspacePath: string, repoRoot: string | null): string[] {
    const roots: string[] = [];
    const normalizedWorkspacePath = path.resolve(workspacePath);
    const normalizedRepoRoot = repoRoot ? path.resolve(repoRoot) : null;
    let currentPath = normalizedWorkspacePath;

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

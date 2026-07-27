import { readdir } from 'node:fs/promises';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { getKimiCodeHome, resolveKimiCliPath } from '@/shared/utils.js';

type KimiCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export class KimiProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Kimi Code CLI is available to the server process.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync(resolveKimiCliPath(), ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns Kimi Code CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'kimi',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Kimi Code keeps OAuth tokens from its device login (`kimi` → `/login`) as
   * individual JSON files under ~/.kimi-code/credentials/. Any credential file
   * means logged in; as a fallback the KIMI_CODE_KEY env (API key from the
   * Kimi Code Console, subscription-backed) also counts, because the CLI can
   * run key-authenticated headless runs.
   */
  private async checkCredentials(): Promise<KimiCredentialsStatus> {
    try {
      const credentialsDir = path.join(getKimiCodeHome(), 'credentials');
      const entries = await readdir(credentialsDir);
      const credentialFile = entries.find((entry) => entry.endsWith('.json'));
      if (credentialFile) {
        return {
          authenticated: true,
          email: `${path.basename(credentialFile, '.json')} OAuth`,
          method: 'credentials_file',
        };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return {
          authenticated: false,
          email: null,
          method: null,
          error: error instanceof Error ? error.message : 'Failed to read Kimi credentials',
        };
      }
    }

    if (process.env.KIMI_CODE_KEY?.trim()) {
      return {
        authenticated: true,
        email: 'KIMI_CODE_KEY',
        method: 'environment',
      };
    }

    return {
      authenticated: false,
      email: null,
      method: null,
      error: 'Kimi Code not logged in — run `kimi` and use /login',
    };
  }
}

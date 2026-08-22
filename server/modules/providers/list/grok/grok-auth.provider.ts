import { readFile } from 'node:fs/promises';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { getGrokHome, readObjectRecord, resolveGrokCliPath } from '@/shared/utils.js';

type GrokCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export class GrokProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Grok Build CLI is available to the server process.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync(resolveGrokCliPath(), ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns Grok Build CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'grok',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * `grok login` (browser OAuth or `--device-auth` on a headless box) writes
   * ~/.grok/auth.json, keyed by issuer+client id:
   *   {"https://auth.x.ai::<client-uuid>": {"key":"<jwt>","auth_mode":"oidc",
   *     "email":"..","user_id":".."}}
   * Any entry with a key means logged in. XAI_API_KEY is the documented
   * fallback the CLI itself honours when no session token is present, so it
   * counts as authenticated too.
   */
  private async checkCredentials(): Promise<GrokCredentialsStatus> {
    try {
      const authPath = path.join(getGrokHome(), 'auth.json');
      const parsed = readObjectRecord(JSON.parse(await readFile(authPath, 'utf8')) as unknown) ?? {};

      for (const value of Object.values(parsed)) {
        const entry = readObjectRecord(value);
        if (!entry || typeof entry.key !== 'string' || !entry.key.trim()) {
          continue;
        }

        const email = typeof entry.email === 'string' && entry.email.trim() ? entry.email.trim() : 'Grok OAuth';
        return {
          authenticated: true,
          email,
          method: typeof entry.auth_mode === 'string' ? entry.auth_mode : 'oauth',
        };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return {
          authenticated: false,
          email: null,
          method: null,
          error: error instanceof Error ? error.message : 'Failed to read Grok credentials',
        };
      }
    }

    if (process.env.XAI_API_KEY?.trim()) {
      return {
        authenticated: true,
        email: 'XAI_API_KEY',
        method: 'environment',
      };
    }

    return {
      authenticated: false,
      email: null,
      method: null,
      error: 'Grok not logged in — run `grok login --device-auth`',
    };
  }
}

import { resolveBundledCodex } from '@/shared/codex-paths.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { readCodexRpc } from './codex-rpc.js';

/** Read account metadata through Codex itself: supports file and keychain stores. */
export class CodexProviderAuth implements IProviderAuth {
  constructor(
    private readonly readAccount = () => readCodexRpc('account/read', { refreshToken: false }),
    private readonly resolveCli = resolveBundledCodex,
  ) {}

  async getStatus(): Promise<ProviderAuthStatus> {
    const base = { provider: 'codex' as const, email: null, method: null };
    try { this.resolveCli(); } catch {
      return { ...base, installed: false, authenticated: false, error: 'Codex SDK native binary is not installed' };
    }
    const result = await this.readAccount().catch(() => null);
    if (!result || typeof result.requiresOpenaiAuth !== 'boolean') {
      return { ...base, installed: true, authenticated: false, error: 'Unable to read Codex authentication status' };
    }
    const account = result.account;
    const authenticated = Boolean(account) || result.requiresOpenaiAuth === false;
    return {
      ...base, installed: true, authenticated,
      email: typeof account?.email === 'string' ? account.email : null,
      // Keep Neo3's API-key UI contract independent of the native enum spelling.
      method: account?.type === 'apiKey' ? 'api_key'
        : typeof account?.type === 'string' ? account.type : authenticated ? 'external_provider' : null,
      error: authenticated ? undefined : 'Not authenticated',
    };
  }
}

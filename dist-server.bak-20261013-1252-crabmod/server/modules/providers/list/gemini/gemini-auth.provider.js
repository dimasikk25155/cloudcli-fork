import { readFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import { getGeminiHome, resolveGeminiCliPath } from '../../../../shared/utils.js';
export class GeminiProviderAuth {
    /**
     * Checks whether the Gemini CLI is available to the server process.
     */
    checkInstalled() {
        try {
            const result = spawn.sync(resolveGeminiCliPath(), ['--version'], { stdio: 'ignore', timeout: 5000 });
            return !result.error && result.status === 0;
        }
        catch {
            return false;
        }
    }
    /**
     * Returns Gemini CLI installation and credential status.
     */
    async getStatus() {
        const installed = this.checkInstalled();
        const credentials = await this.checkCredentials();
        return {
            installed,
            provider: 'gemini',
            authenticated: credentials.authenticated,
            email: credentials.email,
            method: credentials.method,
            error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
        };
    }
    /**
     * Gemini CLI stores the Google OAuth login (the subscription-backed path —
     * personal account / Gemini Code Assist) in ~/.gemini/oauth_creds.json, with
     * the signed-in address in google_accounts.json. That OAuth file is the only
     * state that means "logged in through a subscription".
     *
     * GEMINI_API_KEY is deliberately reported with method `api_key`: it works,
     * but it bills per token instead of riding a subscription, so the UI can tell
     * the two apart rather than showing one indistinguishable green dot.
     */
    async checkCredentials() {
        const home = getGeminiHome();
        try {
            await readFile(path.join(home, 'oauth_creds.json'), 'utf-8');
            return {
                authenticated: true,
                email: await this.readAccountEmail(home),
                method: 'oauth',
            };
        }
        catch (error) {
            const code = error.code;
            if (code !== 'ENOENT') {
                return {
                    authenticated: false,
                    email: null,
                    method: null,
                    error: error instanceof Error ? error.message : 'Failed to read Gemini credentials',
                };
            }
        }
        if (process.env.GEMINI_API_KEY?.trim()) {
            return {
                authenticated: true,
                email: 'GEMINI_API_KEY',
                method: 'api_key',
            };
        }
        return {
            authenticated: false,
            email: null,
            method: null,
            error: 'Gemini CLI not logged in — run `gemini` and pick "Login with Google"',
        };
    }
    /**
     * Best-effort read of the signed-in Google address. A missing or unparsable
     * accounts file is not an auth failure — the OAuth token above already
     * settled that — so the status just goes out without an email.
     */
    async readAccountEmail(home) {
        try {
            const raw = await readFile(path.join(home, 'google_accounts.json'), 'utf-8');
            const parsed = JSON.parse(raw);
            if (typeof parsed.active === 'string' && parsed.active.trim()) {
                return parsed.active.trim();
            }
            if (Array.isArray(parsed.accounts)) {
                const first = parsed.accounts.find((entry) => typeof entry === 'string' && entry.trim());
                return typeof first === 'string' ? first.trim() : null;
            }
            return null;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=gemini-auth.provider.js.map
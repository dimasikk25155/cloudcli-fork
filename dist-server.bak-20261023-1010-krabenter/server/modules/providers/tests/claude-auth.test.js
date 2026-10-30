import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ClaudeProviderAuth } from '../../../modules/providers/list/claude/claude-auth.provider.js';
const checkCredentials = (auth) => auth.checkCredentials();
const ENV_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const withEnv = async (overrides, fn) => {
    const original = {};
    for (const key of ENV_KEYS) {
        original[key] = process.env[key];
        const value = overrides[key];
        if (value === undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
    try {
        await fn();
    }
    finally {
        for (const key of ENV_KEYS) {
            if (original[key] === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = original[key];
            }
        }
    }
};
const withTempHome = async (fn) => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'claude-auth-test-'));
    const originalHome = process.env.HOME;
    process.env.HOME = homeDir;
    try {
        await fn(homeDir);
    }
    finally {
        if (originalHome === undefined) {
            delete process.env.HOME;
        }
        else {
            process.env.HOME = originalHome;
        }
        await rm(homeDir, { recursive: true, force: true });
    }
};
const writeCredentialsFile = async (homeDir, body) => {
    const claudeDir = path.join(homeDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(claudeDir, '.credentials.json'), JSON.stringify(body));
};
const writeSettingsFile = async (homeDir, env) => {
    const claudeDir = path.join(homeDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({ env }));
};
test('checkCredentials: CLAUDE_CODE_OAUTH_TOKEN set is authenticated via environment, even with a stale credentials file', async () => {
    await withTempHome(async (homeDir) => {
        await writeCredentialsFile(homeDir, {
            claudeAiOauth: { accessToken: 'stale-token', expiresAt: 1_000_000_000_000 }, // long expired
        });
        await withEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token' }, async () => {
            const status = await checkCredentials(new ClaudeProviderAuth());
            assert.equal(status.authenticated, true);
            assert.equal(status.method, 'environment');
        });
    });
});
test('checkCredentials: CLAUDE_CODE_OAUTH_TOKEN configured via settings.json env block is authenticated via environment', async () => {
    await withTempHome(async (homeDir) => {
        await writeSettingsFile(homeDir, { CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token-from-settings' });
        await writeCredentialsFile(homeDir, {
            claudeAiOauth: { accessToken: 'stale-token', expiresAt: 1_000_000_000_000 }, // long expired
        });
        await withEnv({}, async () => {
            const status = await checkCredentials(new ClaudeProviderAuth());
            assert.equal(status.authenticated, true);
            assert.equal(status.method, 'environment');
        });
    });
});
test('checkCredentials: no CLAUDE_CODE_OAUTH_TOKEN, valid credentials file falls back to credentials_file', async () => {
    await withTempHome(async (homeDir) => {
        await writeCredentialsFile(homeDir, {
            claudeAiOauth: { accessToken: 'valid-token', expiresAt: Date.now() + 60 * 60 * 1000 },
            email: 'someone@example.com',
        });
        await withEnv({}, async () => {
            const status = await checkCredentials(new ClaudeProviderAuth());
            assert.equal(status.authenticated, true);
            assert.equal(status.method, 'credentials_file');
            assert.equal(status.email, 'someone@example.com');
        });
    });
});
test('checkCredentials: no CLAUDE_CODE_OAUTH_TOKEN, expired credentials file reports not authenticated', async () => {
    await withTempHome(async (homeDir) => {
        await writeCredentialsFile(homeDir, {
            claudeAiOauth: { accessToken: 'stale-token', expiresAt: 1_000_000_000_000 },
        });
        await withEnv({}, async () => {
            const status = await checkCredentials(new ClaudeProviderAuth());
            assert.equal(status.authenticated, false);
            assert.match(status.error ?? '', /expired/i);
        });
    });
});
test('checkCredentials: ANTHROPIC_API_KEY takes precedence over CLAUDE_CODE_OAUTH_TOKEN', async () => {
    await withTempHome(async () => {
        await withEnv({ ANTHROPIC_API_KEY: 'test-api-key', CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token' }, async () => {
            const status = await checkCredentials(new ClaudeProviderAuth());
            assert.equal(status.authenticated, true);
            assert.equal(status.method, 'api_key');
        });
    });
});
//# sourceMappingURL=claude-auth.test.js.map
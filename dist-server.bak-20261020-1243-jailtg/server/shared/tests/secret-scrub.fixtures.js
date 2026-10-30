/**
 * Credential shapes secret-scrub must remove. One source for two tests:
 * secret-scrub.test.ts checks the scrubber removes each `secret`;
 * secret-detect.test.ts checks the composer guard finds each one too.
 * Every value is a fake of the right shape — never a real credential.
 */
export const SCRUB_FIXTURES = [
    {
        kind: 'anthropic',
        secret: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
        text: 'export ANTHROPIC_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    },
    {
        kind: 'github',
        secret: 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
        text: 'git remote set-url origin https://ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789@github.com/x/y',
    },
    {
        kind: 'aws',
        secret: 'AKIAIOSFODNN7EXAMPLE',
        text: 'AWS_ACCESS_KEY_ID вот такой: AKIAIOSFODNN7EXAMPLE',
    },
    {
        kind: 'slack',
        secret: 'xoxb-123456789012-abcdefghijkl',
        text: 'slack bot token xoxb-123456789012-abcdefghijkl',
    },
    {
        kind: 'telegram',
        secret: '123456789:AAHrandomlookingtokenvaluewithlength',
        text: 'curl https://api.telegram.org/bot123456789:AAHrandomlookingtokenvaluewithlength/getMe',
    },
    {
        kind: 'private-key',
        secret: 'MIIEowIBAAKCAQEA1234567890abcdef',
        text: [
            'ключ ниже:',
            '-----BEGIN RSA PRIVATE KEY-----',
            'MIIEowIBAAKCAQEA1234567890abcdef',
            'abcdefghijklmnopqrstuvwxyz012345',
            '-----END RSA PRIVATE KEY-----',
            'конец',
        ].join('\n'),
    },
    {
        kind: 'url-credentials',
        secret: 'sUpErSeCrEtValue',
        text: 'postgres://admin:sUpErSeCrEtValue@db.internal:5432/app',
    },
    {
        kind: 'assignment',
        secret: 'abcdefghijklmnopqrst',
        text: 'DOLPHIN_TOKEN = "abcdefghijklmnopqrst"',
    },
    {
        kind: 'openai',
        secret: 'sk-proj-Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0PpOoNnMm',
        text: 'OpenAI: sk-proj-Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0PpOoNnMm',
    },
    {
        kind: 'jwt',
        secret: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWZha2U',
        text: 'Authorization header: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWZha2U',
    },
];
export function scrubFixture(kind) {
    const fixture = SCRUB_FIXTURES.find((entry) => entry.kind === kind);
    if (!fixture)
        throw new Error(`no scrub fixture for ${kind}`);
    return fixture;
}
//# sourceMappingURL=secret-scrub.fixtures.js.map
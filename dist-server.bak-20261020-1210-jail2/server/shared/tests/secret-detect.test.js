import assert from 'node:assert/strict';
import test from 'node:test';
import { containsSecret } from '../../shared/secret-scrub.js';
import { detectSecrets, redact } from '../../../shared/secret-detect.js';
import { SCRUB_FIXTURES } from './secret-scrub.fixtures.js';
// Every value below is a fake of the right shape — never a real credential.
//
// The composer guard and the CLI hook share `detectSecrets`; the server keeps
// its own `secret-scrub`. The promise to the user is "the guard catches at
// least what the server would have scrubbed", so the first block replays the
// fixtures secret-scrub.test.ts itself uses (secret-scrub.fixtures.ts).
function secretSpanIsCovered(text, secret) {
    const from = text.indexOf(secret);
    const to = from + secret.length;
    return detectSecrets(text).some((finding) => finding.start <= from && finding.end >= to);
}
for (const fixture of SCRUB_FIXTURES) {
    test(`detects what secret-scrub scrubs: ${fixture.kind}`, () => {
        // Sanity: the server scrubber really does treat this text as secret.
        assert.equal(containsSecret(fixture.text), true, 'fixture must be a secret-scrub hit');
        assert.ok(secretSpanIsCovered(fixture.text, fixture.secret), `${fixture.kind} value not covered`);
        assert.equal(detectSecrets(fixture.text)[0]?.kind, fixture.kind);
    });
}
test('ordinary text, commit hashes, UUIDs and password-less URLs are not secrets', () => {
    const clean = [
        'Запусти тесты и покажи, что упало. Потом поправь ключевые места и пришли токены дизайна.',
        'Откатись на коммит 3f9a2c7 и сравни с 9b1d6e04c2a85f3317d0e6b2a4c9f8e1d7a3b5c6 — там починили вход.',
        'git cherry-pick 0123456789abcdef0123456789abcdef01234567',
        'Сессия 123e4567-e89b-42d3-a456-426614174000 зависла, ключ сессии не нужен.',
        'Открой https://example.com:8080/path?x=1 и https://user@github.com/org/repo.git',
        'PORT=3001, password: no, pass: ok, bypass: enabledflag, passport: 1234567890',
        'Лог: /Users/dimasik/Antigravity Project/claude agent/cloudcli-fork/src/components/chat/hooks/useChatComposerState.ts',
        'Пароль от вайфая спроси у Славика.',
        // Ordinary code: identifiers and expressions are not secret values.
        "const token = localStorage.getItem('authToken')",
        'apiKey: process.env.OPENAI_API_KEY',
        'const password = req.body.password',
        'password: hashedPassword',
        'sessionToken: generateSessionToken()',
    ];
    for (const text of clean) {
        assert.deepEqual(detectSecrets(text), [], `false positive in: ${text}`);
    }
});
test('explicit passwords with a 6+ char value are caught, short ones are not', () => {
    const cases = [
        { text: 'пароль: Kx7!qz2m', secret: 'Kx7!qz2m', name: 'PASSWORD' },
        { text: 'Пароль=hunter22 от админки', secret: 'hunter22', name: 'PASSWORD' },
        { text: 'зайди, pass: fake-pw-01, логин admin', secret: 'fake-pw-01', name: 'PASSWORD' },
        { text: 'pwd=abc123', secret: 'abc123', name: 'PASSWORD' },
        { text: 'DB_PASSWORD=s3cr3t!', secret: 's3cr3t!', name: 'DB_PASSWORD' },
    ];
    for (const { text, secret, name } of cases) {
        const findings = detectSecrets(text);
        assert.equal(findings.length, 1, `expected one finding in: ${text}`);
        assert.equal(findings[0].kind, 'password');
        assert.equal(text.slice(findings[0].start, findings[0].end), secret);
        assert.equal(findings[0].suggestedName, name);
    }
    assert.deepEqual(detectSecrets('пароль: 12345'), []);
});
test('a long hex/base64 run next to key/token/ключ/токен is caught; the same run alone is not', () => {
    const hex = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const b64 = 'QWxhZGRpbjpvcGVuIHNlc2FtZQ0K9xYz/Lm+Pq3RsTuVwXy==';
    const near = [
        { text: `вот ключ от сервиса ${hex}`, secret: hex, name: 'API_KEY' },
        { text: `Токен доступа: ${b64}`, secret: b64, name: 'API_TOKEN' },
        { text: `${hex} — это secret вебхука`, secret: hex, name: 'SECRET' },
    ];
    for (const { text, secret, name } of near) {
        const findings = detectSecrets(text);
        assert.equal(findings.length, 1, `expected one finding in: ${text}`);
        assert.equal(findings[0].kind, 'generic');
        assert.equal(text.slice(findings[0].start, findings[0].end), secret);
        assert.equal(findings[0].suggestedName, name);
    }
    assert.deepEqual(detectSecrets(`контрольная сумма файла ${hex}`), []);
});
test('suggested names reuse the variable the user typed and always fit [A-Z][A-Z0-9_]*', () => {
    const typed = detectSecrets('export ANTHROPIC_API_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    assert.equal(typed[0].suggestedName, 'ANTHROPIC_API_KEY');
    const dotted = detectSecrets('openai.api_key: "abcdefghijklmnopqrstuv"');
    assert.equal(dotted[0].suggestedName, 'OPENAI_API_KEY');
    const url = detectSecrets('redis://default:fakeRedisPass123@cache:6379');
    assert.equal(url[0].suggestedName, 'REDIS_PASSWORD');
    const prose = detectSecrets('Authorization header: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWZha2U');
    assert.equal(prose[0].suggestedName, 'JWT_TOKEN', 'a lone word before a colon is prose, not a variable');
    for (const fixture of SCRUB_FIXTURES) {
        for (const finding of detectSecrets(fixture.text)) {
            assert.match(finding.suggestedName, /^[A-Z][A-Z0-9_]*$/);
        }
    }
});
test('redact cuts every value out and leaves [REDACTED:NAME]; the result is clean', () => {
    const text = 'gh: ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789, пароль: Kx7!qz2m — проверь';
    const findings = detectSecrets(text);
    assert.equal(findings.length, 2);
    const result = redact(text, findings, ['GH_TOKEN', '']);
    assert.equal(result, 'gh: [REDACTED:GH_TOKEN], пароль: [REDACTED:PASSWORD] — проверь');
    assert.deepEqual(detectSecrets(result), [], 'a redacted message must not trip the guard again');
});
test('a reference to a stashed variable is not a secret', () => {
    assert.deepEqual(detectSecrets('DOLPHIN_TOKEN=$DOLPHIN_TOKEN (лежит в .secrets.env)'), []);
    assert.deepEqual(detectSecrets('пароль: ${DB_PASSWORD}'), []);
});
test('real assignments next to code-looking ones are still caught', () => {
    const cases = [
        { text: 'password=Xk9!mq2Lp', secret: 'Xk9!mq2Lp' },
        { text: 'api_key="sk-proj-Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0PpOoNnMm"', secret: 'sk-proj-Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0PpOoNnMm' },
        { text: 'api_key="Zx81kLmQ0pRt7vWy"', secret: 'Zx81kLmQ0pRt7vWy' },
        { text: "SECRET_TOKEN='onlylettersbutquoted'", secret: 'onlylettersbutquoted' },
        // A plain word after a password keyword is a password, not an identifier.
        { text: 'password: dimasik', secret: 'dimasik' },
        { text: 'pass: Moscowcity', secret: 'Moscowcity' },
        { text: 'DB_PASSWORD=SuperSecret', secret: 'SuperSecret' },
        { text: 'password=correcthorsebattery', secret: 'correcthorsebattery' },
        { text: 'password qwerty_admin', secret: 'qwerty_admin' },
        { text: 'api_key=AbCdEfGhIjKlMnOpQrStUv', secret: 'AbCdEfGhIjKlMnOpQrStUv' },
    ];
    for (const { text, secret } of cases) {
        assert.ok(secretSpanIsCovered(text, secret), `missed: ${text}`);
    }
});
//# sourceMappingURL=secret-detect.test.js.map
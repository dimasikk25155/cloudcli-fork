/**
 * Finds credentials in text a person is about to send to an agent.
 *
 * One detector for three callers: the chat composer (vite), the server (tsx /
 * tsc) and the terminal Claude Code UserPromptSubmit hook, which imports this
 * file directly on Node 24 with no build step. Hence the constraints:
 *   - no imports, no Node or DOM APIs — pure string work;
 *   - erasable TypeScript only (types and `as const`; no enums, namespaces,
 *     parameter properties), so Node's built-in type stripping can run it.
 *
 * Coverage promise: everything `server/shared/secret-scrub.ts` scrubs is found
 * here too (tested by replaying its fixtures), plus explicit passwords and a
 * generic "long random string next to the word key/token" case. secret-scrub
 * itself is not touched — it guards logs, this guards the send button.
 *
 * A finding carries only offsets, never the value: callers slice the value out
 * of their own text when (and only when) they need it.
 */

export type SecretKind =
  | 'private-key'
  | 'anthropic'
  | 'openai'
  | 'github'
  | 'aws'
  | 'slack'
  | 'telegram'
  | 'jwt'
  | 'url-credentials'
  | 'assignment'
  | 'password'
  | 'service'
  | 'generic';

export type SecretFinding = {
  kind: SecretKind;
  /** Offset of the secret value in the scanned text (inclusive). */
  start: number;
  /** Offset just past the secret value (exclusive). */
  end: number;
  /** Variable name for .secrets.env; always matches SECRET_NAME_PATTERN. */
  suggestedName: string;
  /** Which service the key belongs to («ключ Groq»), when the format says so. */
  label?: string;
};

/** The only names the stash and the dialog accept. */
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const KIND_LABELS: Record<SecretKind, string> = {
  'private-key': 'приватный ключ',
  anthropic: 'ключ Anthropic',
  openai: 'ключ OpenAI',
  github: 'токен GitHub',
  aws: 'ключ AWS',
  slack: 'токен Slack',
  telegram: 'токен Telegram-бота',
  jwt: 'JWT-токен',
  'url-credentials': 'пароль в ссылке',
  assignment: 'ключ или токен',
  password: 'пароль',
  service: 'ключ сервиса',
  generic: 'что-то похожее на ключ',
};

/** Human label in Russian: «Похоже, в сообщении <label>». */
export function describeSecretKind(kind: SecretKind): string {
  return KIND_LABELS[kind] ?? 'секрет';
}

/** Label for one finding: the service name when known, else the kind. */
export function describeFinding(finding: Pick<SecretFinding, 'kind' | 'label'>): string {
  return finding.label ?? describeSecretKind(finding.kind);
}

const DEFAULT_NAMES: Partial<Record<SecretKind, string>> = {
  'private-key': 'PRIVATE_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  github: 'GITHUB_TOKEN',
  aws: 'AWS_ACCESS_KEY_ID',
  slack: 'SLACK_TOKEN',
  telegram: 'TELEGRAM_BOT_TOKEN',
  jwt: 'JWT_TOKEN',
  assignment: 'SECRET',
  password: 'PASSWORD',
  generic: 'API_KEY',
};

type Candidate = SecretFinding & { priority: number };

type Rule = {
  kind: SecretKind;
  pattern: RegExp;
  /** Capture group with the secret value; the whole match when absent. */
  valueGroup?: number;
  /** Capture group with a variable name worth reusing as suggestedName. */
  nameGroup?: number;
  /** Reuse the name only when it is compound (`DB_PASSWORD`, not `pass`). */
  compoundNameOnly?: boolean;
  /** Capture group with the opening quote, if any, before the value. */
  quoteGroup?: number;
  /** Capture group with the separator between keyword and value. */
  separatorGroup?: number;
  /**
   * `key = value` rules also match ordinary code (`token = getToken()`):
   * an unquoted value that looks like an identifier or expression is skipped.
   */
  skipCodeValues?: boolean;
  /** Service label and variable name (`service` rules). */
  label?: string;
  name?: string;
};

/**
 * Keys a service recognises by their prefix — caught even when pasted alone,
 * with no "key"/"token" word nearby. Formats come from the services' docs and
 * public secret-scanner rule sets; lengths are lower bounds on purpose, so a
 * format that grows a few characters keeps matching. The value must still
 * look random (see looksRandom), so `re_compile_pattern` stays quiet.
 * Keep `_` and `-` straight: OpenAI is `sk-…`, ElevenLabs is `sk_…`.
 */
const SERVICE_KEYS: Array<[label: string, name: string, pattern: RegExp]> = [
  ['ключ OpenRouter', 'OPENROUTER_API_KEY', /\bsk-or-v1-[a-f0-9]{64}\b/g],
  ['ключ ElevenLabs', 'ELEVENLABS_API_KEY', /\bsk_[a-f0-9]{48}\b/g],
  ['ключ Stripe', 'STRIPE_SECRET_KEY', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ['секрет вебхука Stripe', 'STRIPE_WEBHOOK_SECRET', /\bwhsec_[A-Za-z0-9+/=]{24,}/g],
  ['ключ Groq', 'GROQ_API_KEY', /\bgsk_[A-Za-z0-9]{40,}/g],
  ['ключ xAI (Grok)', 'XAI_API_KEY', /\bxai-[A-Za-z0-9]{40,}/g],
  ['ключ Google (Gemini, Maps…)', 'GOOGLE_API_KEY', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['секрет OAuth Google', 'GOOGLE_CLIENT_SECRET', /\bGOCSPX-[A-Za-z0-9_-]{20,}/g],
  ['токен доступа Google', 'GOOGLE_ACCESS_TOKEN', /\bya29\.[A-Za-z0-9_-]{30,}/g],
  ['токен GitHub', 'GITHUB_TOKEN', /\bgithub_pat_[A-Za-z0-9_]{40,}/g],
  ['токен GitLab', 'GITLAB_TOKEN', /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ['токен Hugging Face', 'HF_TOKEN', /\bhf_[A-Za-z0-9]{30,}/g],
  ['токен Replicate', 'REPLICATE_API_TOKEN', /\br8_[A-Za-z0-9]{30,}/g],
  ['ключ Perplexity', 'PERPLEXITY_API_KEY', /\bpplx-[A-Za-z0-9]{40,}/g],
  ['ключ Tavily', 'TAVILY_API_KEY', /\btvly-(?:dev-|prod-)?[A-Za-z0-9]{24,}/g],
  ['ключ Firecrawl', 'FIRECRAWL_API_KEY', /\bfc-[a-f0-9]{32}\b/g],
  ['ключ Fireworks', 'FIREWORKS_API_KEY', /\bfw_[A-Za-z0-9]{20,}/g],
  ['ключ Resend', 'RESEND_API_KEY', /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}/g],
  ['вебхук Slack', 'SLACK_WEBHOOK_URL', /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/g],
  ['вебхук Discord', 'DISCORD_WEBHOOK_URL', /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{50,}/g],
  ['токен Discord-бота', 'DISCORD_BOT_TOKEN', /\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g],
  ['ключ SendGrid', 'SENDGRID_API_KEY', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{30,}/g],
  ['ключ Twilio', 'TWILIO_API_KEY', /\bSK[0-9a-f]{32}\b/g],
  ['ключ Mailgun', 'MAILGUN_API_KEY', /\bkey-[0-9a-f]{32}\b/g],
  ['токен Shopify', 'SHOPIFY_ACCESS_TOKEN', /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g],
  ['токен npm', 'NPM_TOKEN', /\bnpm_[A-Za-z0-9]{36,}/g],
  ['токен PyPI', 'PYPI_TOKEN', /\bpypi-[A-Za-z0-9_-]{50,}/g],
  ['токен Supabase', 'SUPABASE_ACCESS_TOKEN', /\bsbp_[a-f0-9]{40}\b/g],
  ['секретный ключ Supabase', 'SUPABASE_SECRET_KEY', /\bsb_secret_[A-Za-z0-9_-]{20,}/g],
  ['токен DigitalOcean', 'DIGITALOCEAN_TOKEN', /\bdo[opr]_v1_[a-f0-9]{64}\b/g],
  ['ключ Linear', 'LINEAR_API_KEY', /\blin_api_[A-Za-z0-9]{32,}/g],
  ['токен Notion', 'NOTION_TOKEN', /\b(?:ntn_[A-Za-z0-9]{40,}|secret_[A-Za-z0-9]{43})\b/g],
  ['токен Figma', 'FIGMA_TOKEN', /\bfigd_[A-Za-z0-9_-]{30,}/g],
  ['токен Airtable', 'AIRTABLE_TOKEN', /\bpat[A-Za-z0-9]{14}\.[a-f0-9]{64}\b/g],
  ['ключ Postman', 'POSTMAN_API_KEY', /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}\b/g],
  ['токен Atlassian', 'ATLASSIAN_API_TOKEN', /\bATATT3[A-Za-z0-9_=-]{100,}/g],
  ['токен Sentry', 'SENTRY_AUTH_TOKEN', /\bsntry[su]_[A-Za-z0-9+/=_]{40,}/g],
  ['OAuth-токен Яндекса', 'YANDEX_OAUTH_TOKEN', /\by0_[A-Za-z0-9_-]{40,}/g],
  ['ключ Yandex Cloud', 'YANDEX_API_KEY', /\bAQVN[A-Za-z0-9_-]{30,}/g],
  ['IAM-токен Yandex Cloud', 'YANDEX_IAM_TOKEN', /\bt1\.[A-Za-z0-9_-]+=*\.[A-Za-z0-9_-]{80,}/g],
  ['токен VK', 'VK_TOKEN', /\bvk1\.a\.[A-Za-z0-9_-]{50,}/g],
  ['токен Facebook / Meta', 'META_ACCESS_TOKEN', /\bEAA[A-Za-z0-9]{80,}/g],
  ['ключ сервиса', 'API_KEY', /\bsk_[A-Za-z0-9_-]{32,}/g],
];

// Ordered from most to least specific: when two rules claim overlapping text
// the earlier one wins (an `sk-ant-…` key is "Anthropic", not "OpenAI").
// Apart from SERVICE_KEYS and Bearer, these mirror secret-scrub's patterns.
const RULES: Rule[] = [
  {
    kind: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { kind: 'anthropic', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  ...SERVICE_KEYS.map(([label, name, pattern]): Rule => ({ kind: 'service', pattern, label, name })),
  { kind: 'openai', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { kind: 'github', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { kind: 'aws', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'slack', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'telegram', pattern: /(?<![\d:])\d{8,12}:AA[A-Za-z0-9_-]{30,}/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: 'url-credentials',
    // Group 1 = scheme (names the variable), group 2 = the password.
    pattern: /([a-z][a-z0-9+.-]*):\/\/[^\s/:@]+:([^\s@/]{3,})(?=@)/gi,
    valueGroup: 2,
  },
  {
    kind: 'assignment',
    pattern:
      /\b([\w.-]*(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|bearer|authorization|access[_-]?key))\b\s*[:=]\s*(["']?)([^\s"',;]{12,})/gi,
    valueGroup: 3,
    nameGroup: 1,
    quoteGroup: 2,
    skipCodeValues: true,
  },
  {
    kind: 'password',
    // `пароль:` / `password=` / `pass:` / `pwd=` with a 6+ char value, or
    // `password qwerty_admin` (space only: see SPACE_SEPARATED_VALUE). The
    // keyword must start a word or follow `_ . -` (DB_PASSWORD), so `bypass:`
    // and `passport:` stay quiet.
    pattern:
      /(?<![\p{L}\p{N}_])((?:[A-Za-z0-9.-]*[_.-])?(?:password|passwd|pass|pwd|пароль))(?![\p{L}\p{N}])(\s*[:=]\s*|[ \t]+)(["'`]?)([^\s"'`]{6,})/giu,
    valueGroup: 4,
    nameGroup: 1,
    compoundNameOnly: true,
    separatorGroup: 2,
    quoteGroup: 3,
    skipCodeValues: true,
  },
  {
    kind: 'service',
    // `Authorization: Bearer …` copied from curl or devtools.
    pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g,
    valueGroup: 1,
    label: 'токен в заголовке Authorization',
    name: 'BEARER_TOKEN',
  },
];

// Generic case: a 32+ char hex/base64-ish run close to a key-ish word.
const GENERIC_CANDIDATE = /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/_=-])/g;
const GENERIC_KEYWORD = /(?<!\p{L})(?:(?:api[_-]?)?keys?|tokens?|secrets?)(?![a-z])|(?<!\p{L})(?:ключ|токен|секрет)/giu;
const KEYWORD_WINDOW_BEFORE = 48;
const KEYWORD_WINDOW_AFTER = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// References and earlier redactions are not secrets: after "Убрать в
// .secrets.env" the text says `$NAME`, and re-checking it must stay quiet.
const PLACEHOLDER =
  /^(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\[REDACTED[^\]]*\]|«REDACTED[^»]*»|\*{3,}|•{3,}|<[^<>]*>|x{6,}|X{6,})$/;

// Only separators that practically never end a real password: trimming `!`
// or `.` would store a truncated value under the user's name.
const TRAILING_PUNCTUATION = /[,;)]+$/;

/** Turns `openai.api-key` into `OPENAI_API_KEY`; null when nothing usable is left. */
function toEnvName(raw: string): string | null {
  const name = raw
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[^A-Z]+/, '')
    .replace(/_+$/, '');
  return name && SECRET_NAME_PATTERN.test(name) ? name.slice(0, 64) : null;
}

/**
 * `ANTHROPIC_KEY=sk-ant-…` — the variable the user already typed is a better
 * name than our default. Only compound identifiers are taken (with `_` or
 * `.`): a lone word before a colon ("header:") is prose, not a variable.
 */
function nameTypedBefore(text: string, start: number): string | null {
  const before = text.slice(Math.max(0, start - 80), start);
  const match = before.match(/(?:^|[^A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]*[_.][A-Za-z0-9_.-]*)\s*[:=]\s*["'`]?$/);
  return match ? toEnvName(match[1]) : null;
}

const IDENTIFIER_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
const PLAIN_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const CAMEL_CASE = /^[a-z][a-z0-9]*[A-Z]/;
const LOWER_SNAKE = /^[a-z]+(?:_[a-z]+)+$/;
const CODE_WORDS = new Set([
  'null', 'undefined', 'true', 'false', 'none', 'nil', 'env', 'self', 'this',
  'required', 'optional', 'string', 'number', 'boolean', 'object', 'hidden',
]);
// `password qwerty_admin` has no `:`/`=`, so prose like "password manager"
// must not count: the space form needs a digit, `_` or a symbol in the value.
const SPACE_SEPARATED_VALUE = /[^A-Za-zА-Яа-яЁё]/;

type ValueContext = {
  /** Text on the same line before the keyword. */
  lineBefore: string;
  /** Text right after the value. */
  after: string;
};

/** `const x = …`, `{ password: … }`, or an indented `key: value,` line of an object literal. */
function isCodeAssignment({ lineBefore, after }: ValueContext): boolean {
  if (/\b(?:const|let|var)\s/.test(lineBefore) || lineBefore.includes('{')) return true;
  return /^\s*$/.test(lineBefore) && /^\s*,/.test(after);
}

/** Mixed case that switches every 1–2 letters is random, not words glued together. */
function looksRandomMixedCase(value: string): boolean {
  const switches = value.match(/[a-z][A-Z]|[A-Z][a-z]/g)?.length ?? 0;
  return value.length >= 20 && value.length / (switches + 1) < 3;
}

/**
 * `localStorage.getItem(`, `process.env.OPENAI_API_KEY`, `req.body.password`,
 * `hashedPassword`, `generateSessionToken()` — code, not a credential.
 * A dotted chain counts as code unless a segment is long and has digits (a
 * Mapbox-style `pk.eyJ1…` token). A lone word counts as code only with an
 * explicit identifier sign: camelCase, lower snake_case inside a code
 * assignment, or a known code word. `dimasik`, `Moscowcity`, `SuperSecret`,
 * `correcthorsebattery` stay passwords.
 */
function looksLikeCode(value: string, context: ValueContext): boolean {
  if (/[([{]/.test(value)) return true;
  if (/^process\.env\./.test(value)) return true;
  if (IDENTIFIER_CHAIN.test(value)) {
    return value.split('.').every((segment) => !/\d/.test(segment) || segment.length <= 16);
  }
  if (!PLAIN_IDENTIFIER.test(value) || /\d/.test(value)) return false;
  if (CODE_WORDS.has(value.toLowerCase())) return true;
  if (CAMEL_CASE.test(value)) return !looksRandomMixedCase(value);
  if (LOWER_SNAKE.test(value)) return isCodeAssignment(context);
  return false;
}

/** Real keys mix in digits or switch case at random; `re_compile_pattern` does neither. */
function looksRandom(value: string): boolean {
  return /\d/.test(value) || looksRandomMixedCase(value);
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value);
}

function genericName(keywordMatch: string): string {
  const word = keywordMatch.toLowerCase();
  if (word.startsWith('tok') || word.startsWith('ток')) return 'API_TOKEN';
  if (word.startsWith('sec') || word.startsWith('сек')) return 'SECRET';
  return 'API_KEY';
}

function collectRuleCandidates(text: string, out: Candidate[]): void {
  RULES.forEach((rule, priority) => {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const whole = match[0];
      const matchStart = match.index ?? 0;
      let value = rule.valueGroup ? match[rule.valueGroup] ?? '' : whole;
      if (!value) continue;
      if (rule.kind === 'password') {
        value = value.replace(TRAILING_PUNCTUATION, '');
        if (value.length < 6) continue;
      }
      if (isPlaceholder(value)) continue;
      if (rule.kind === 'service' && !looksRandom(value)) continue;
      // A quoted value is a literal; Cyrillic keywords (`пароль:`) are prose.
      const quoted = rule.quoteGroup ? Boolean(match[rule.quoteGroup]) : false;
      const proseKeyword = rule.nameGroup ? /[^\x00-\x7F]/.test(match[rule.nameGroup] ?? '') : false;
      const separator = rule.separatorGroup ? match[rule.separatorGroup] ?? '' : '';
      if (separator && !/[:=]/.test(separator) && (proseKeyword || !SPACE_SEPARATED_VALUE.test(value))) continue;
      if (rule.skipCodeValues && !quoted && !proseKeyword) {
        const lineStart = text.lastIndexOf('\n', matchStart - 1) + 1;
        const valueEnd = matchStart + whole.length;
        const context = { lineBefore: text.slice(lineStart, matchStart), after: text.slice(valueEnd, valueEnd + 3) };
        if (looksLikeCode(value, context)) continue;
      }

      // The value sits at the end of the match for every rule with a value
      // group except url-credentials, where a lookahead keeps `@…` outside.
      const offsetInMatch = rule.valueGroup ? whole.lastIndexOf(match[rule.valueGroup] ?? '') : 0;
      const start = matchStart + Math.max(0, offsetInMatch);
      const end = start + value.length;

      let suggestedName: string | null = null;
      if (rule.name) suggestedName = nameTypedBefore(text, start) ?? rule.name;
      const typedName = rule.nameGroup ? match[rule.nameGroup] ?? '' : '';
      if (typedName && (!rule.compoundNameOnly || /[_.-]/.test(typedName))) {
        suggestedName = toEnvName(typedName);
      }
      if (!suggestedName && rule.kind === 'url-credentials') {
        const scheme = toEnvName(match[1] ?? '');
        suggestedName = scheme ? `${scheme}_PASSWORD` : 'URL_PASSWORD';
      }
      if (!suggestedName && rule.kind !== 'private-key' && rule.kind !== 'url-credentials') {
        suggestedName = nameTypedBefore(text, start);
      }

      out.push({
        kind: rule.kind,
        start,
        end,
        suggestedName: suggestedName ?? DEFAULT_NAMES[rule.kind] ?? 'SECRET',
        ...(rule.label ? { label: rule.label } : {}),
        priority,
      });
    }
  });
}

function collectGenericCandidates(text: string, out: Candidate[]): void {
  GENERIC_CANDIDATE.lastIndex = 0;
  for (const match of text.matchAll(GENERIC_CANDIDATE)) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;

    // Random keys mix letters and digits; long words and paths do not.
    if (!/[0-9]/.test(value) || !/[A-Za-z]/.test(value)) continue;
    if (UUID.test(value) || value.startsWith('/') || value.includes('//')) continue;

    const windowBefore = text.slice(Math.max(0, start - KEYWORD_WINDOW_BEFORE), start);
    const windowAfter = text.slice(end, end + KEYWORD_WINDOW_AFTER);
    GENERIC_KEYWORD.lastIndex = 0;
    const keywords = [...windowBefore.matchAll(GENERIC_KEYWORD), ...windowAfter.matchAll(GENERIC_KEYWORD)];
    if (keywords.length === 0) continue;

    out.push({
      kind: 'generic',
      start,
      end,
      suggestedName: nameTypedBefore(text, start) ?? genericName(keywords[0][0]),
      priority: RULES.length,
    });
  }
}

// A key from a service with no prefix (Mistral, Cohere, Cloudflare…) pasted
// alone on its line. Needs digits plus both cases and must not read as words:
// hex hashes, PascalCase names and snake/kebab identifiers stay quiet.
const BARE_LINE = /^[ \t]*([A-Za-z0-9_+=-]{24,256})[ \t]*$/gm;
// Words of 2+ letters, ACRONYMS and numbers; each piece is taken whole, so the
// check is linear and a random string (single letters between digits) fails.
const WORDY = /^(?:(?:[A-Z]?[a-z]{2,}(?![a-z])|[A-Z]{2,}(?![A-Za-z])|\d+(?!\d))[_-]?)+$/;

function collectBareLineCandidates(text: string, out: Candidate[]): void {
  BARE_LINE.lastIndex = 0;
  for (const match of text.matchAll(BARE_LINE)) {
    const value = match[1];
    if (!/\d/.test(value) || !/[a-z]/.test(value) || !/[A-Z]/.test(value)) continue;
    if (WORDY.test(value)) continue;
    const start = (match.index ?? 0) + match[0].indexOf(value);
    out.push({ kind: 'generic', start, end: start + value.length, suggestedName: 'API_KEY', priority: RULES.length + 1 });
  }
}

/**
 * Lists credentials found in `text`, ordered by position, non-overlapping.
 * Never throws; non-string input yields no findings.
 */
export function detectSecrets(text: string): SecretFinding[] {
  if (typeof text !== 'string' || text.length === 0) return [];

  const candidates: Candidate[] = [];
  try {
    collectRuleCandidates(text, candidates);
    collectGenericCandidates(text, candidates);
    collectBareLineCandidates(text, candidates);
  } catch {
    return [];
  }

  candidates.sort((a, b) => a.priority - b.priority || a.start - b.start || b.end - a.end);
  const accepted: Candidate[] = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some((taken) => candidate.start < taken.end && taken.start < candidate.end);
    if (!overlaps) accepted.push(candidate);
  }

  return accepted
    .sort((a, b) => a.start - b.start)
    .map(({ kind, start, end, suggestedName, label }) => ({ kind, start, end, suggestedName, ...(label ? { label } : {}) }));
}

/**
 * Replaces each finding's span with `replacements[i]`. Findings may come in
 * any order; they must not overlap (detectSecrets guarantees that).
 */
export function replaceFindings(text: string, findings: SecretFinding[], replacements: string[]): string {
  const order = findings.map((finding, index) => ({ finding, index })).sort((a, b) => b.finding.start - a.finding.start);
  let result = text;
  for (const { finding, index } of order) {
    const replacement = replacements[index] ?? `[REDACTED:${finding.suggestedName}]`;
    result = result.slice(0, finding.start) + replacement + result.slice(finding.end);
  }
  return result;
}

/** Cuts every finding out of the text, leaving `[REDACTED:NAME]` behind. */
export function redact(text: string, findings: SecretFinding[], names: string[]): string {
  return replaceFindings(
    text,
    findings,
    findings.map((finding, index) => `[REDACTED:${names[index] || finding.suggestedName}]`),
  );
}

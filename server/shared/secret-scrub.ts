/**
 * Removes credentials from text before it is stored or forwarded.
 *
 * Written because a scan of 25 recent session transcripts on this machine found
 * 11 GitHub tokens in plain text and 30 `token|secret|password = <value>`
 * assignments. An audit log that stores raw prompts and command output would
 * become a second place those keys live — a feature meant to increase safety
 * quietly making it worse.
 *
 * Deliberately NOT an LLM classifier: this must be deterministic, free, and
 * testable. A regex cannot be talked out of matching by text inside the very
 * document it is scanning.
 *
 * Honest about its limits — this is a curated deny-list, not proof of absence.
 * It catches the shapes that actually leak; a hand-typed password with no
 * recognisable prefix and no assignment syntax will pass through.
 */

import crypto from 'crypto';

export type RedactionHit = {
  /** Which rule fired — 'anthropic', 'github', 'aws', … */
  kind: string;
  /** Stable 4-hex fingerprint of the secret, so repeats are recognisable. */
  fingerprint: string;
};

export type ScrubResult = {
  text: string;
  hits: RedactionHit[];
};

type Rule = {
  kind: string;
  pattern: RegExp;
  /**
   * Which capture group holds the secret. When absent, the whole match is the
   * secret. Used by rules that must keep surrounding context (the variable
   * name in an assignment stays; only the value goes).
   */
  group?: number;
};

// Order matters only for readability — every rule runs over the text.
const RULES: Rule[] = [
  { kind: 'anthropic', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { kind: 'github', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { kind: 'aws', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'slack', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  // No leading \b: the token almost always follows `bot` with no separator
  // (`api.telegram.org/bot123456789:AA…`), and `t1` is not a word boundary.
  { kind: 'telegram', pattern: /(?<![\d:])\d{8,12}:AA[A-Za-z0-9_-]{30,}/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  // Credentials embedded in a URL: keep the host, drop the password.
  // Any scheme, not just http — the ones that actually carry passwords are
  // postgres://, redis://, mongodb://, amqp://.
  {
    kind: 'url-credentials',
    pattern: /([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)([^\s@/]{3,})(?=@)/gi,
    group: 2,
  },
  // The generic shape. The key *name* is kept — "which credential leaked" is
  // useful and is not itself a secret; only the value is replaced.
  //
  // The `[\w.-]*` prefix matters: real variables are named `DOLPHIN_TOKEN` or
  // `openai.api_key`, and `\btoken\b` never matches inside them because `_` is
  // a word character, so there is no boundary to anchor on.
  {
    kind: 'assignment',
    pattern:
      /\b[\w.-]*(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|bearer|authorization|access[_-]?key)\b\s*[:=]\s*["']?([^\s"',;]{12,})/gi,
    group: 1,
  },
];

/**
 * Values pulled from the process environment.
 *
 * This is the only layer that knows about *this* installation's secrets — a
 * proxy password or a Dolphin token has no recognisable prefix and no regex
 * would ever match it. Names are filtered by the same keyword list; values
 * shorter than 12 characters are skipped because short env values (`PORT`,
 * `NODE_ENV`) would otherwise redact ordinary words out of the text.
 */
const ENV_KEY_HINT = /(api[_-]?key|secret|token|password|passwd|credential|private[_-]?key)/i;
const MIN_ENV_VALUE_LENGTH = 12;

let envDenylistCache: string[] | null = null;

export function buildEnvDenylist(env: NodeJS.ProcessEnv = process.env): string[] {
  const values = new Set<string>();

  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < MIN_ENV_VALUE_LENGTH) continue;
    if (!ENV_KEY_HINT.test(name)) continue;
    values.add(value);
  }

  // Longest first: if one secret contains another as a substring, replacing the
  // longer one first avoids leaving a mangled tail behind.
  return [...values].sort((a, b) => b.length - a.length);
}

/** Test seam — lets a test reset the memoised environment scan. */
export function resetEnvDenylistCache(): void {
  envDenylistCache = null;
}

function fingerprint(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 4);
}

function placeholder(kind: string, secret: string): string {
  // A fingerprint rather than flat asterisks: the same secret produces the same
  // placeholder, so a reader (or a model reading a generated skill) can tell
  // "the same token as above" without ever seeing the value.
  return `«REDACTED:${kind}:${fingerprint(secret)}»`;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the text with credentials replaced, plus what was found.
 *
 * Never throws: a scrubber that can fail is a scrubber that gets wrapped in a
 * try/catch which silently writes the raw text.
 */
export function scrubSecrets(input: string | null | undefined): ScrubResult {
  if (!input || typeof input !== 'string') {
    return { text: '', hits: [] };
  }

  let text = input;
  const hits: RedactionHit[] = [];

  try {
    for (const rule of RULES) {
      text = text.replace(rule.pattern, (match, ...groups) => {
        const secret = rule.group ? String(groups[rule.group - 1] ?? '') : match;
        if (!secret) return match;

        hits.push({ kind: rule.kind, fingerprint: fingerprint(secret) });
        const token = placeholder(rule.kind, secret);
        // Rules with a capture group keep everything around the value.
        return rule.group ? match.replace(secret, token) : token;
      });
    }

    if (envDenylistCache === null) {
      envDenylistCache = buildEnvDenylist();
    }

    for (const secret of envDenylistCache) {
      if (!text.includes(secret)) continue;
      hits.push({ kind: 'env', fingerprint: fingerprint(secret) });
      text = text.replaceAll(secret, placeholder('env', secret));
    }
  } catch (err: any) {
    // Fail closed: if scrubbing broke mid-way, hand back something inert rather
    // than the original text.
    console.error('secret scrub failed', { error: err?.message });
    return { text: '[текст удалён: не удалось проверить на секреты]', hits };
  }

  return { text, hits };
}

/** True when the text still looks like it carries a credential. */
export function containsSecret(text: string | null | undefined): boolean {
  return scrubSecrets(text).hits.length > 0;
}

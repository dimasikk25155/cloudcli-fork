import type { SecretGuardOutcome } from './secretGuard';

export type OwnAnswersGuardResult =
  | { ok: true; texts: Map<number, string> }
  | { ok: false; error?: string };

/**
 * Runs every own answer of the question panel through the secret guard, one
 * by one. Any cancel stops the whole submit: nothing reaches the agent and
 * the panel stays open with the text intact.
 */
export async function guardOwnAnswers(
  texts: Map<number, string>,
  guard: (text: string) => Promise<SecretGuardOutcome>,
): Promise<OwnAnswersGuardResult> {
  const guarded = new Map<number, string>();
  for (const [index, text] of texts) {
    if (!text.trim()) {
      guarded.set(index, text);
      continue;
    }
    const outcome = await guard(text);
    if (outcome.action === 'cancel') {
      return { ok: false, error: outcome.error };
    }
    guarded.set(index, outcome.text);
  }
  return { ok: true, texts: guarded };
}

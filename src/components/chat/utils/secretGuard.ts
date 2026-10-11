/**
 * The secret guard every composer send path goes through.
 *
 * Pure decision logic: the dialog (`ask`) and the HTTP stash (`stash`) are
 * injected, so the hook wires the real ones and tests wire fakes. The secret
 * value only ever travels from the user's text to `stash` — the dialog sees
 * kinds and names, never values.
 */

import {
  SECRET_NAME_PATTERN,
  describeSecretKind,
  detectSecrets,
  redact,
  replaceFindings,
  type SecretFinding,
  type SecretKind,
} from '../../../../shared/secret-detect.js';

/** One distinct secret value in the message (repeats share one item). */
export type SecretGuardItem = {
  kind: SecretKind;
  label: string;
  suggestedName: string;
};

export type SecretGuardPrompt = {
  items: SecretGuardItem[];
  /** Admin: «Убрать в .secrets.env». Everyone else: «Убрать из сообщения». */
  canStash: boolean;
};

export type SecretGuardChoice =
  | { action: 'cancel' }
  | { action: 'send-as-is' }
  /** names[i] belongs to prompt.items[i]. */
  | { action: 'redact'; names: string[] }
  | { action: 'stash'; names: string[] };

export type SecretGuardOutcome =
  | { action: 'send'; text: string }
  /** Keep the text in the composer; `error` is safe to show (never a value). */
  | { action: 'cancel'; error?: string };

export type SecretGuardDeps = {
  isAdmin: boolean;
  ask: (prompt: SecretGuardPrompt) => Promise<SecretGuardChoice>;
  /** Saves the value, resolves with the name actually used (may get `_2`). */
  stash: (name: string, value: string) => Promise<string>;
};

export const STASH_REFERENCE_SUFFIX = '(лежит в .secrets.env)';

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

type Group = { value: string; item: SecretGuardItem; findingIndexes: number[] };

function groupByValue(text: string, findings: SecretFinding[]): Group[] {
  const groups = new Map<string, Group>();
  findings.forEach((finding, index) => {
    const value = text.slice(finding.start, finding.end);
    const existing = groups.get(value);
    if (existing) {
      existing.findingIndexes.push(index);
      return;
    }
    groups.set(value, {
      value,
      item: { kind: finding.kind, label: describeSecretKind(finding.kind), suggestedName: finding.suggestedName },
      findingIndexes: [index],
    });
  });
  return [...groups.values()];
}

function namesPerFinding(groups: Group[], findingCount: number, groupNames: string[]): string[] {
  const perFinding = new Array<string>(findingCount);
  groups.forEach((group, groupIndex) => {
    for (const index of group.findingIndexes) perFinding[index] = groupNames[groupIndex];
  });
  return perFinding;
}

export async function runSecretGuard(text: string, deps: SecretGuardDeps): Promise<SecretGuardOutcome> {
  const findings = detectSecrets(text);
  if (findings.length === 0) return { action: 'send', text };

  const groups = groupByValue(text, findings);
  const choice = await deps.ask({ items: groups.map((group) => group.item), canStash: deps.isAdmin });

  if (choice.action === 'cancel') return { action: 'cancel' };
  if (choice.action === 'send-as-is') return { action: 'send', text };

  const names = groups.map((group, index) => (choice.names[index] ?? '').trim() || group.item.suggestedName);
  if (names.some((name) => !isValidSecretName(name))) {
    return { action: 'cancel', error: 'Имя — заглавные латинские буквы, цифры и _' };
  }

  if (choice.action === 'redact') {
    const perFinding = namesPerFinding(groups, findings.length, names);
    return { action: 'send', text: redact(text, findings, perFinding) };
  }

  // Only the admin writes into the secrets file; the server enforces it too.
  if (!deps.isAdmin) return { action: 'cancel', error: 'Сохранять в .secrets.env может только админ' };

  const savedNames: string[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    try {
      savedNames.push(await deps.stash(names[index], groups[index].value));
    } catch (error) {
      const reason = error instanceof Error && error.message ? `: ${error.message}` : '';
      return { action: 'cancel', error: `Не удалось убрать ключ в .secrets.env${reason}` };
    }
  }

  const perFinding = namesPerFinding(groups, findings.length, savedNames);
  return {
    action: 'send',
    text: replaceFindings(text, findings, perFinding.map((name) => `$${name} ${STASH_REFERENCE_SUFFIX}`)),
  };
}

// Single source of truth for "which engines this build can run".
//
// The list used to be copy-pasted in three places (agent API whitelist,
// unattended runs, /models catalog pick). Adding an engine meant editing all
// three, and forgetting one showed up only at runtime as a 400 or as a Claude
// catalog served for another engine. Import this instead of retyping the array.
export const SUPPORTED_PROVIDERS = ['claude', 'cursor', 'codex', 'opencode', 'kimi', 'gemini', 'grok'];

export const isSupportedProvider = (value) =>
  typeof value === 'string' && SUPPORTED_PROVIDERS.includes(value);

/**
 * Per-instance differences, read from build-time env vars.
 *
 * The same repository is built for the production VPS and for the local
 * laptop instance, so anything that differs between the two lives here as an
 * OPTIONAL variable. Every export below must return the pre-existing
 * behaviour when its variable is unset — that is the contract that keeps
 * production untouched by a build made for the laptop.
 */

/**
 * Only Vite defines `import.meta.env`; under plain Node (the test runner)
 * it is `undefined`, hence the fallback. Keeps these helpers unit-testable
 * outside a browser build.
 */
const ENV = (import.meta.env ?? {}) as Record<string, string | undefined>;

/**
 * Is an optional on/off variable switched on?
 *
 * Unset, empty, or anything that is not an explicit yes counts as OFF, so a
 * build that never heard of the variable behaves exactly as before.
 */
export function isFlagOn(raw: string | undefined | null): boolean {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return normalized === '1' || normalized === 'true';
}

/**
 * Which Claude model a brand-new chat starts on.
 *
 * `builtInDefault` is what shipped before this variable existed, and it is
 * what you get whenever `VITE_DEFAULT_CLAUDE_MODEL` is unset or blank. The
 * value is not validated against the model catalogue on purpose: an unknown
 * id self-corrects to the catalogue's own DEFAULT on the first render (see
 * `pickStoredOrCurrent` in useChatProviderState), and a per-chat pick stored
 * in localStorage still wins over this default.
 */
export function defaultClaudeModel(
  builtInDefault: string,
  configured: string | undefined | null = ENV.VITE_DEFAULT_CLAUDE_MODEL,
): string {
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  return trimmed || builtInDefault;
}

/**
 * Hide the project layer in the sidebar (`VITE_HIDE_PROJECTS=1`).
 *
 * Interface only — projects still exist and still own the sessions. Hiding
 * the project header and the "new project" button is what pins the instance
 * to the folder it was set up with.
 */
export const HIDE_PROJECTS = isFlagOn(ENV.VITE_HIDE_PROJECTS);

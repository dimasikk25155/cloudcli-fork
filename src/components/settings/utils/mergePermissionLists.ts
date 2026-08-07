/**
 * Saving the settings page used to overwrite `claude-settings` wholesale with
 * the React state loaded when the page opened. Anything remembered in the
 * meantime — every "Allow & remember" pressed in a chat writes the same key —
 * was silently wiped, so the button looked broken.
 *
 * Merge instead: keep what is on disk now, add what the user added here, and
 * only drop entries the user actually removed on this page (loaded → edited).
 */
export function mergePermissionListOnSave(
  loaded: readonly string[],
  edited: readonly string[],
  onDisk: readonly string[],
): string[] {
  const editedSet = new Set(edited);
  const removedHere = new Set(loaded.filter((entry) => !editedSet.has(entry)));

  const merged: string[] = [];
  for (const entry of [...onDisk, ...edited]) {
    if (!removedHere.has(entry) && !merged.includes(entry)) {
      merged.push(entry);
    }
  }

  return merged;
}

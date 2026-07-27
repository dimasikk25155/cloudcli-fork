// Plugin display names come from each plugin's own manifest, so they are always
// English. Localize the ones we ship/recommend, keyed by the plugin's stable
// manifest `name` (the manifest displayName can change between versions).
// Unknown plugins fall back to their manifest name unchanged.
const LOCALIZED_PLUGIN_NAMES: Record<string, string> = {
  'project-stats': 'plugins.names.projectStats',
  terminal: 'plugins.names.terminal',
};

/**
 * Translate a plugin's manifest display name when we have a localization for it.
 * @param pluginName stable plugin id from the manifest (e.g. "project-stats")
 * @param displayName manifest display name, used as the fallback
 * @param t i18next translate function
 */
export function localizePluginName(
  pluginName: string,
  displayName: string,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  const key = LOCALIZED_PLUGIN_NAMES[pluginName];
  if (!key) return displayName;
  return t(key, { defaultValue: displayName });
}

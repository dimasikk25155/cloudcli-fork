import React, { createContext, useContext, useState, useEffect } from 'react';

import { authenticatedFetch } from '../utils/api';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Full app themes ("skins"): each one restyles the whole UI — colours, fonts,
// panels and background — via a `data-theme` attribute on <html>. Added one at
// a time as each is built out; `default` is the original warm-orange look.
export const THEMES = [
  'claude',
  'default',
  'liquidGlass',
  'neonCity',
  'synthwaveDrive',
  'commandDeck',
  'nebulaFlow',
  'missionControl',
  'bento3d',
  'kineticType',
  'liquidChrome',
  'zenParticles',
  'aether',
];

// The theme new installs open with (no saved preference yet). Existing users
// keep whatever they already picked — see the `theme` initial state below.
export const DEFAULT_THEME = 'claude';

// Human-readable labels for the theme picker in Settings → Appearance.
// Internal key stays `liquidGlass` (matches CSS/asset filenames); label is
// what the user actually sees in the dropdown.
export const THEME_LABELS = {
  claude: 'Claude',
  default: 'Тёмная',
  liquidGlass: 'Apple',
  neonCity: 'Neon City',
  synthwaveDrive: 'Aurora',
  commandDeck: 'Command Deck',
  nebulaFlow: 'Nebula Flow',
  missionControl: 'Mission Control',
  bento3d: 'Deep Space',
  kineticType: 'Kinetic Type',
  liquidChrome: 'Ink Flow',
  zenParticles: 'Bioluminescence',
  aether: 'Aether',
};

// Themes that are light (bright) rather than dark. Each theme decides whether
// the global `dark` class is applied — there is no separate user dark/light
// toggle. `default` and anything not listed here is treated as dark.
export const LIGHT_THEMES = ['liquidGlass'];

// Backwards-compatible aliases (older code referred to these as shader variants).
export const SHADER_VARIANTS = THEMES;
export const SHADER_VARIANT_LABELS = THEME_LABELS;

export const ThemeProvider = ({ children }) => {
  // Animated WebGL background (opt-out).
  const [shaderEnabled, setShaderEnabledRaw] = useState(() => {
    const saved = localStorage.getItem('shaderBg');
    return saved === null ? true : saved === 'on';
  });
  const [theme, setThemeRaw] = useState(() => {
    const saved = localStorage.getItem('appTheme') || localStorage.getItem('shaderVariant');
    return THEMES.includes(saved) ? saved : DEFAULT_THEME;
  });

  // The active theme decides whether the app is dark or light.
  const isDarkMode = !LIGHT_THEMES.includes(theme);

  // Account-wide theme/shader defaults, loaded once on mount and applied on
  // top of whatever localStorage had (server is the cross-device source of
  // truth; localStorage is just this browser's instant-paint cache). Uses
  // the raw setters so this doesn't itself trigger a sync-back PUT.
  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/settings/ui-preferences')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.preferences) {
          return;
        }
        const { theme: savedTheme, shaderEnabled: savedShaderEnabled } = data.preferences;
        if (typeof savedTheme === 'string' && THEMES.includes(savedTheme)) {
          setThemeRaw(savedTheme);
        }
        if (typeof savedShaderEnabled === 'boolean') {
          setShaderEnabledRaw(savedShaderEnabled);
        }
      })
      .catch((error) => {
        console.warn('Failed to load account theme preferences:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('shaderBg', shaderEnabled ? 'on' : 'off');
  }, [shaderEnabled]);

  // The active theme drives both its `data-theme` attribute and the global
  // `dark` class + browser chrome, so light themes flip everything at once.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('appTheme', theme);

    const dark = !LIGHT_THEMES.includes(theme);
    root.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');

    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBarMeta) {
      statusBarMeta.setAttribute('content', dark ? 'black-translucent' : 'default');
    }

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', dark ? '#141414' : '#eef2f9');
    }
  }, [theme]);

  // Fire-and-forget: push the new value to the account so every other
  // device (phone, another browser) picks it up on its next load. Local
  // state/localStorage already made the change feel instant on this device;
  // a failed sync just means other devices stay on the old value until it
  // succeeds again, never blocks or reverts this one.
  const setShaderEnabled = (next) => {
    setShaderEnabledRaw(next);
    authenticatedFetch('/api/settings/ui-preferences', {
      method: 'PUT',
      body: JSON.stringify({ shaderEnabled: next }),
    }).catch((error) => {
      console.warn('Failed to sync shader preference to account:', error);
    });
  };

  const setTheme = (next) => {
    setThemeRaw(next);
    authenticatedFetch('/api/settings/ui-preferences', {
      method: 'PUT',
      body: JSON.stringify({ theme: next }),
    }).catch((error) => {
      console.warn('Failed to sync theme preference to account:', error);
    });
  };

  const value = {
    isDarkMode,
    // No-op kept for backward compatibility with any lingering callers.
    toggleDarkMode: () => {},
    shaderEnabled,
    setShaderEnabled,
    toggleShader: () => setShaderEnabled(!shaderEnabled),
    // Full app theme.
    theme,
    setTheme,
    // Backwards-compatible aliases.
    shaderVariant: theme,
    setShaderVariant: setTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

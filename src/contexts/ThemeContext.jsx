import React, { createContext, useContext, useState, useEffect } from 'react';

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
];

// Human-readable labels for the theme picker in Settings → Appearance.
// Internal key stays `liquidGlass` (matches CSS/asset filenames); label is
// what the user actually sees in the dropdown.
export const THEME_LABELS = {
  default: 'Тёмная',
  liquidGlass: 'Apple',
  neonCity: 'Neon City',
  synthwaveDrive: 'Synthwave',
  commandDeck: 'Command Deck',
  nebulaFlow: 'Nebula Flow',
  missionControl: 'Mission Control',
  bento3d: 'Bento 3D',
  kineticType: 'Kinetic Type',
  liquidChrome: 'Liquid Chrome',
  zenParticles: 'Zen Particles',
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
  const [shaderEnabled, setShaderEnabled] = useState(() => {
    const saved = localStorage.getItem('shaderBg');
    return saved === null ? true : saved === 'on';
  });
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('appTheme') || localStorage.getItem('shaderVariant');
    return THEMES.includes(saved) ? saved : 'default';
  });

  // The active theme decides whether the app is dark or light.
  const isDarkMode = !LIGHT_THEMES.includes(theme);

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

  const value = {
    isDarkMode,
    // No-op kept for backward compatibility with any lingering callers.
    toggleDarkMode: () => {},
    shaderEnabled,
    setShaderEnabled,
    toggleShader: () => setShaderEnabled((prev) => !prev),
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

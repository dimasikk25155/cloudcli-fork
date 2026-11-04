import type { ITerminalOptions, ITheme } from '@xterm/xterm';

export const SHELL_RESTART_DELAY_MS = 200;
export const TERMINAL_INIT_DELAY_MS = 100;
export const TERMINAL_RESIZE_DELAY_MS = 50;

// CLI prompt overlay detection
export const PROMPT_DEBOUNCE_MS = 500;
export const PROMPT_BUFFER_SCAN_LINES = 20;
export const PROMPT_OPTION_SCAN_LINES = 15;
export const PROMPT_MAX_OPTIONS = 5;
export const PROMPT_MIN_OPTIONS = 2;

// Тёмная палитра (VS Code Dark) — та, что была у терминала всегда.
// Тёмные темы получают её без изменений.
const DARK_TERMINAL_THEME: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
  extendedAnsi: [
    '#000000',
    '#800000',
    '#008000',
    '#808000',
    '#000080',
    '#800080',
    '#008080',
    '#c0c0c0',
    '#808080',
    '#ff0000',
    '#00ff00',
    '#ffff00',
    '#0000ff',
    '#ff00ff',
    '#00ffff',
    '#ffffff',
  ],
};

// Светлая палитра для светлых тем: белый лист, тёплый почти чёрный текст,
// ANSI-цвета притемнены, чтобы держать ≥3:1 на белом (жёлтый и голубой
// тёмной палитры на белом не читаются). `white`/`brightWhite` — светлые
// серые: ими CLI рисует фон плашек, а не текст.
const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#1f1e1d',
  cursor: '#1f1e1d',
  cursorAccent: '#ffffff',
  selectionBackground: '#f2d9cc',
  selectionForeground: '#1f1e1d',
  black: '#1f1e1d',
  red: '#b42318',
  green: '#1a7f37',
  yellow: '#8a6100',
  blue: '#1f5fbf',
  magenta: '#8e3fa8',
  cyan: '#0b7285',
  white: '#d9d7cf',
  brightBlack: '#6b6a65',
  brightRed: '#c8371e',
  brightGreen: '#2b8a3e',
  brightYellow: '#9a6b00',
  brightBlue: '#2b6fd6',
  brightMagenta: '#a04bbd',
  brightCyan: '#0e7f94',
  brightWhite: '#f0eee6',
  extendedAnsi: [
    '#1f1e1d',
    '#8c1d14',
    '#156b2e',
    '#735100',
    '#173f87',
    '#6e2f84',
    '#085e6c',
    '#6b6a65',
    '#8f8d86',
    '#b42318',
    '#1a7f37',
    '#8a6100',
    '#1f5fbf',
    '#8e3fa8',
    '#0b7285',
    '#f0eee6',
  ],
};

/**
 * Палитра xterm под текущую тему приложения. Каждый вызов — новый объект:
 * xterm сравнивает `options.theme` по ссылке и перекрашивает только на новую.
 */
export function terminalThemeFor(isDarkMode: boolean): ITheme {
  const source = isDarkMode ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
  return { ...source, extendedAnsi: [...(source.extendedAnsi ?? [])] };
}

export const TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  allowProposedApi: true,
  allowTransparency: false,
  convertEol: true,
  scrollback: 10000,
  tabStopWidth: 4,
  windowsMode: false,
  macOptionIsMeta: true,
  macOptionClickForcesSelection: true,
  // Стартовая палитра — тёмная, как раньше; useShellTerminal сразу ставит
  // палитру текущей темы и меняет её на лету при переключении.
  theme: terminalThemeFor(true),
};

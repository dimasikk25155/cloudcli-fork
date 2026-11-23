/**
 * Цвета неоновых плиток — те же, что у аватарок ботов Neo³
 * (`bots-control/avatars/src/make_avatars.py`): тёмно-синий фон, белый символ
 * и акцент проекта. Это цвета РАЗМЕТКИ: тёмные темы показывают их как есть,
 * светлые перекрашивают основу и символ значениями `--icon-tile-*` (index.css).
 */

/** Tile background, `BASE` of the bot avatars. */
export const NEON_BASE = '#090C18';

/** Main symbol colour, `WHITE` of the bot avatars. */
export const NEON_WHITE = '#F0F5FF';

/** Accent palette of the bot avatars; a project's accent is one of these. */
export const NEON_ACCENTS = [
  '#4FD1FF',
  '#3DDC97',
  '#3B82F6',
  '#FFB547',
  '#FFC83D',
  '#34D399',
  '#FF5A5F',
  '#B67CFF',
  '#5EEAD4',
  '#FF7AB6',
  '#A78BFA',
  '#F43F5E',
  '#C264FF',
  '#38BDF8',
  '#F7931A',
  '#22D3A0',
  '#60A5FA',
  '#FF6B3D',
  '#2DD4BF',
  '#7DD3FC',
  '#FB923C',
  '#F472B6',
] as const;

export type NeonAccent = (typeof NEON_ACCENTS)[number];

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const parsed = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(parsed)) return [0, 0, 0];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

/**
 * Centre colour of the radial glow: `BASE * 0.55 + accent * 0.22`, exactly as
 * `background()` in make_avatars.py mixes it.
 */
export function neonGlowTint(accent: string): string {
  const base = channels(NEON_BASE);
  const tint = channels(accent);
  const mixed = base.map((value, index) => Math.round(value * 0.55 + tint[index] * 0.22));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

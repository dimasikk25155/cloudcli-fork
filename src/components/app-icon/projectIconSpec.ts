export type ProjectGlyph =
  | 'tire'
  | 'car'
  | 'wallet'
  | 'smile'
  | 'mic'
  | 'mountain'
  | 'scale'
  | 'bag'
  | 'leaf'
  | 'music'
  | 'moon'
  | 'code'
  | 'calendar'
  | 'workflow'
  | 'shield'
  | 'server'
  | 'settings'
  | 'tasks'
  | 'globe'
  | 'flask'
  | 'building'
  | 'coins'
  | 'play'
  | 'user'
  | 'share'
  | 'sparkles'
  | 'image'
  | 'map'
  | 'camera'
  | 'droplets'
  | 'gem'
  | 'wrench'
  | 'gauge'
  | 'message'
  | 'ban'
  | 'clapper'
  | 'neo3'
  | 'folder';

export type IconSpec = {
  background: string;
  foreground: string;
  glyph: ProjectGlyph;
  letter: string;
};

const FALLBACK_COLORS: Array<Pick<IconSpec, 'background' | 'foreground'>> = [
  { background: '#C45C26', foreground: '#FFF6EE' },
  { background: '#1F4E5A', foreground: '#E7F4F2' },
  { background: '#3E2A78', foreground: '#F1ECFF' },
  { background: '#7A2E3A', foreground: '#FFE8E6' },
  { background: '#2F5D32', foreground: '#EAF6E8' },
  { background: '#1C3A70', foreground: '#E8F0FF' },
  { background: '#6B4E16', foreground: '#FFF3D6' },
  { background: '#3A3A3A', foreground: '#F3F3F0' },
];

const PRESETS: Array<{ match: RegExp; spec: Omit<IconSpec, 'letter'> }> = [
  // Mazda is Dima's personal car. Tyres KZ/KG is the client shop. Never
  // collapse them: a mazda path that mentions tires must stay a car.
  { match: /mazda|мазд/i, spec: { background: '#4A5560', foreground: '#F4F1EA', glyph: 'car' } },
  { match: /tyres?|samruk|шин/i, spec: { background: '#1C1917', foreground: '#E8C36A', glyph: 'tire' } },
  { match: /consigliere|канцел/i, spec: { background: '#5C3A21', foreground: '#F3D2A8', glyph: 'wallet' } },
  // Neo3 itself: its own mark (Neo3Mark.tsx), no longer a smiley.
  { match: /claude\s*agent|cloudcli/i, spec: { background: '#D97757', foreground: '#FFF7F0', glyph: 'neo3' } },
  { match: /neo3-hub|neo3\s*hub/i, spec: { background: '#D97757', foreground: '#FFF7F0', glyph: 'neo3' } },
  { match: /neo3-demo/i, spec: { background: '#C45C26', foreground: '#FFF6EE', glyph: 'play' } },
  { match: /neo3-vpn|\bvpn\b/i, spec: { background: '#1C3A70', foreground: '#E8F0FF', glyph: 'shield' } },
  { match: /wh?isper|wisper/i, spec: { background: '#111827', foreground: '#FDE68A', glyph: 'mic' } },
  { match: /gora|гора/i, spec: { background: '#1F4D3A', foreground: '#D8F3DC', glyph: 'mountain' } },
  { match: /пристав|pristav|долг|gosuslugi|помощник max/i, spec: { background: '#1E293B', foreground: '#F8FAFC', glyph: 'scale' } },
  { match: /avito|авито/i, spec: { background: '#166534', foreground: '#ECFDF3', glyph: 'bag' } },
  { match: /travka|травк|lfk/i, spec: { background: '#365314', foreground: '#ECFCCB', glyph: 'leaf' } },
  { match: /karaoke|караоке|(^|\s)music(\s|$)/i, spec: { background: '#9D174D', foreground: '#FCE7F3', glyph: 'music' } },
  { match: /alhamdulillah/i, spec: { background: '#1C1917', foreground: '#F5D07A', glyph: 'moon' } },
  { match: /difinance|финанс/i, spec: { background: '#14532D', foreground: '#DCFCE7', glyph: 'wallet' } },
  { match: /image-generate/i, spec: { background: '#7C2D12', foreground: '#FFEDD5', glyph: 'image' } },
  { match: /eurasia|еврази/i, spec: { background: '#1E3A5F', foreground: '#DBEAFE', glyph: 'globe' } },
  { match: /agtest/i, spec: { background: '#5B21B6', foreground: '#EDE9FE', glyph: 'flask' } },
  { match: /archi/i, spec: { background: '#44403C', foreground: '#F5F5F4', glyph: 'building' } },
  { match: /crypto/i, spec: { background: '#B45309', foreground: '#FEF3C7', glyph: 'coins' } },
  { match: /(^|\s)demo(\s|$)/i, spec: { background: '#0F766E', foreground: '#CCFBF1', glyph: 'play' } },
  { match: /dimasik/i, spec: { background: '#9A3412', foreground: '#FFEDD5', glyph: 'user' } },
  { match: /facebook/i, spec: { background: '#1D4ED8', foreground: '#DBEAFE', glyph: 'share' } },
  { match: /(^|\s)generate(\s|$)/i, spec: { background: '#6B21A8', foreground: '#F3E8FF', glyph: 'sparkles' } },
  { match: /gmap/i, spec: { background: '#15803D', foreground: '#DCFCE7', glyph: 'map' } },
  { match: /insta-comments/i, spec: { background: '#9D174D', foreground: '#FCE7F3', glyph: 'message' } },
  { match: /insta-kill/i, spec: { background: '#881337', foreground: '#FFE4E6', glyph: 'ban' } },
  { match: /insta/i, spec: { background: '#BE185D', foreground: '#FCE7F3', glyph: 'camera' } },
  { match: /kvadro|баня/i, spec: { background: '#0E7490', foreground: '#CFFAFE', glyph: 'droplets' } },
  { match: /matreshka|матр/i, spec: { background: '#9F1239', foreground: '#FFE4E6', glyph: 'gem' } },
  { match: /probe/i, spec: { background: '#57534E', foreground: '#E7E5E4', glyph: 'wrench' } },
  { match: /speedtest/i, spec: { background: '#0369A1', foreground: '#E0F2FE', glyph: 'gauge' } },
  { match: /(^|\s)tmp(\s|$)/i, spec: { background: '#3A3A3A', foreground: '#F3F3F0', glyph: 'code' } },
  // Common words in other people's projects. Last, so they never beat a preset above.
  // `\b` is ASCII-only in JS: the Cyrillic and `bot` edges are spelled out.
  { match: /film|кино|video|видео/i, spec: { background: '#312E81', foreground: '#E0E7FF', glyph: 'clapper' } },
  { match: /reels|shorts|tiktok/i, spec: { background: '#BE123C', foreground: '#FFE4E6', glyph: 'play' } },
  {
    match: /waba|whatsapp|вотсап|telegram|(^|[^a-z])bot([^a-z]|$)|(^|[^а-яё])бот/i,
    spec: { background: '#15803D', foreground: '#DCFCE7', glyph: 'message' },
  },
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function firstLetter(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed[0].toUpperCase();
}

export function monogram(name: string): string {
  const parts = name.trim().split(/[\s\-_]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  const compact = name.replace(/[^0-9A-Za-zА-Яа-яЁё]/g, '');
  if (compact.length >= 2) {
    return compact.slice(0, 2).toUpperCase();
  }

  return firstLetter(name);
}

/** Last non-empty path segment; both `/` and `\` separate. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * Presets look at the project name and its own folder name only: a project
 * that merely lives under `claude agent/`, `cloudcli/` or `/Users/dimasik/`
 * must not wear that folder's icon.
 */
export function resolveProjectIcon(name: string, path = ''): IconSpec {
  const subject = `${name} ${folderName(path)}`;
  // The fallback colour still hashes the full path, so existing tiles keep their colour.
  const haystack = `${name} ${path}`;
  const letter = firstLetter(name);

  for (const preset of PRESETS) {
    if (preset.match.test(subject)) {
      return { ...preset.spec, letter };
    }
  }

  const palette = FALLBACK_COLORS[hashString(haystack.toLowerCase()) % FALLBACK_COLORS.length];
  return {
    ...palette,
    glyph: 'folder',
    letter: monogram(name),
  };
}

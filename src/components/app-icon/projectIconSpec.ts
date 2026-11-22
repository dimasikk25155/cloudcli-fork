/**
 * Проект → неоновый значок (символ + цвет) в стиле аватарок ботов Neo³.
 * Сначала явная таблица по имени проекта или имени его папки (весь список
 * проектов Димы на 22.11), затем символ по ключевым словам, иначе «папка».
 * Цвет для незнакомых — из неоновой палитры по хешу пути: стабильно, без букв.
 */
import { NEON_ACCENTS } from './neon/neonPalette';
import type { NeonGlyph } from './neon/neonGlyphs';

export type { NeonGlyph } from './neon/neonGlyphs';
/** Older name of the glyph key, kept for callers. */
export type ProjectGlyph = NeonGlyph;

/** Where the icon came from: the explicit table, a keyword rule, or the folder fallback. */
export type ProjectIconMatch = 'table' | 'keyword' | 'fallback';

export type IconSpec = {
  glyph: NeonGlyph;
  accent: string;
  match: ProjectIconMatch;
};

type TableEntry = { keys: string[]; glyph: NeonGlyph; accent: string };

// Имена — как в списке проектов Neo3 и как называются папки (без регистра).
// Похожие проекты (линейка Tyres, демо и рабочие версии) различаются цветом или символом.
const PROJECT_TABLE: TableEntry[] = [
  // Tyres: магазин шин в KZ/KG, 7su, менеджер Сергей. Mazda — личная машина, не шины.
  { keys: ['tyres kz', 'tyres'], glyph: 'tire', accent: '#FFC83D' },
  { keys: ['tyres 7su', 'tyres-7su'], glyph: 'tire', accent: '#FF6B3D' },
  { keys: ['tyres kg', 'tyres-kg'], glyph: 'tire', accent: '#22D3A0' },
  { keys: ['tyres bot', 'tyres-bot'], glyph: 'robot', accent: '#FB923C' },
  { keys: ['tyres store', 'tyres-store'], glyph: 'cart', accent: '#2DD4BF' },
  { keys: ['tyres-kz-team'], glyph: 'users', accent: '#FFC83D' },
  { keys: ['линии сергея', 'tyres-sergey-lines'], glyph: 'message', accent: '#3DDC97' },
  { keys: ['elki'], glyph: 'tree', accent: '#22D3A0' },
  { keys: ['mazda'], glyph: 'car', accent: '#F43F5E' },

  // Neo3 и инструменты вокруг него.
  { keys: ['claude agent'], glyph: 'neo3', accent: '#FF6B3D' },
  { keys: ['cloudcli-fork', 'cloudcli'], glyph: 'neo3', accent: '#38BDF8' },
  { keys: ['neo3-hub'], glyph: 'neo3', accent: '#B67CFF' },
  { keys: ['neo3 desktop', 'neo3-desktop'], glyph: 'laptop', accent: '#4FD1FF' },
  { keys: ['neo3 outreach', 'neo3-outreach'], glyph: 'megaphone', accent: '#38BDF8' },
  { keys: ['neo3 visual', 'neo3-visual'], glyph: 'image', accent: '#C264FF' },
  { keys: ['neo3 visual share', 'neo3-visual-share'], glyph: 'share', accent: '#A78BFA' },
  { keys: ['neo3-vpn'], glyph: 'shield', accent: '#22D3A0' },
  { keys: ['antigravity project'], glyph: 'rocket', accent: '#B67CFF' },
  { keys: ['глобальные (вне проектов)', 'dimasik'], glyph: 'home', accent: '#FFB547' },
  { keys: ['вольт dimasik', 'dimasik-obsidian'], glyph: 'book', accent: '#B67CFF' },
  { keys: ['brand'], glyph: 'star', accent: '#FF7AB6' },
  { keys: ['brand-obsidian'], glyph: 'gem', accent: '#C264FF' },
  { keys: ['consigliere'], glyph: 'wallet', accent: '#FFC83D' },
  { keys: ['session audit', 'session-audit'], glyph: 'eye', accent: '#4FD1FF' },
  { keys: ['task killer', 'task-killer'], glyph: 'gauge', accent: '#FF5A5F' },
  { keys: ['rag vault', 'rag-vault'], glyph: 'database', accent: '#5EEAD4' },
  { keys: ['vault mcp', 'vault-mcp'], glyph: 'database', accent: '#A78BFA' },
  { keys: ['ollama mcp', 'ollama-mcp'], glyph: 'chip', accent: '#3DDC97' },
  { keys: ['telegram mcp', 'telegram-mcp'], glyph: 'plane', accent: '#38BDF8' },
  { keys: ['windows mcp', 'windows-mcp'], glyph: 'windows', accent: '#3B82F6' },
  { keys: ['n8n'], glyph: 'workflow', accent: '#FF7AB6' },
  { keys: ['alt-tab'], glyph: 'switcher', accent: '#7DD3FC' },
  { keys: ['open design', 'open-design'], glyph: 'palette', accent: '#F472B6' },
  { keys: ['claude motion'], glyph: 'clapper', accent: '#B67CFF' },

  // Боты и голос.
  { keys: ['bots platform', 'bots-platform'], glyph: 'robot', accent: '#5EEAD4' },
  { keys: ['content agent', 'content-agent'], glyph: 'pen', accent: '#FF7AB6' },
  { keys: ['content bots', 'content-bots'], glyph: 'megaphone', accent: '#FB923C' },
  { keys: ['parser rss', 'parser-rss'], glyph: 'rss', accent: '#FB923C' },
  { keys: ['max bridge', 'max-bridge'], glyph: 'bridge', accent: '#3B82F6' },
  { keys: ['china wear bot', 'china-wear-bot'], glyph: 'shirt', accent: '#F43F5E' },
  { keys: ['de letter bot', 'de-letter-bot'], glyph: 'envelope', accent: '#A78BFA' },
  { keys: ['grok bot', 'grok-bot'], glyph: 'bolt', accent: '#4FD1FF' },
  { keys: ['grok bot friend', 'grok-bot-friend'], glyph: 'bolt', accent: '#FF7AB6' },
  { keys: ['grokbot'], glyph: 'bolt', accent: '#FFB547' },
  { keys: ['monitor wb bot', 'monitor-wb-bot'], glyph: 'parcel', accent: '#C264FF' },
  { keys: ['marketplace finder', 'marketplace-finder'], glyph: 'search', accent: '#FF6B3D' },
  { keys: ['price tracker', 'price-tracker'], glyph: 'tag', accent: '#FFB547' },
  { keys: ['avito ai', 'avito-ai'], glyph: 'bag', accent: '#34D399' },
  { keys: ['stt bot', 'stt-bot'], glyph: 'speech', accent: '#60A5FA' },
  { keys: ['wisper'], glyph: 'mic', accent: '#FF7AB6' },
  { keys: ['neowhisper bot', 'neowhisper-bot'], glyph: 'mic', accent: '#F472B6' },
  { keys: ['neowhisper android', 'neowhisper-android'], glyph: 'phone', accent: '#FF7AB6' },
  { keys: ['karaoke english', 'karaoke-english'], glyph: 'music', accent: '#F472B6' },
  { keys: ['music'], glyph: 'headphones', accent: '#A78BFA' },
  { keys: ['ai secretary', 'ai-secretary'], glyph: 'calendar', accent: '#A78BFA' },
  { keys: ['lead gen agent', 'lead-gen-agent'], glyph: 'magnet', accent: '#FF5A5F' },
  { keys: ['бух-бот', 'buh-bot'], glyph: 'calculator', accent: '#34D399' },
  { keys: ['помощник max (приставы)', 'gosuslugi-rag'], glyph: 'scale', accent: '#60A5FA' },

  // Деньги, крипта, трейдинг.
  { keys: ['trading'], glyph: 'candles', accent: '#3DDC97' },
  { keys: ['prop-trading'], glyph: 'candles', accent: '#60A5FA' },
  { keys: ['falcon xau'], glyph: 'goldbar', accent: '#FFC83D' },
  { keys: ['million-dollar-idea'], glyph: 'bulb', accent: '#FFC83D' },
  { keys: ['div-arb'], glyph: 'exchange', accent: '#2DD4BF' },
  { keys: ['crypto brief', 'crypto-brief'], glyph: 'chart', accent: '#F7931A' },
  { keys: ['crypto-broker'], glyph: 'bitcoin', accent: '#FFB547' },
  { keys: ['crypto1'], glyph: 'coins', accent: '#FFC83D' },
  { keys: ['btc splash demo', 'btc-splash-demo'], glyph: 'bitcoin', accent: '#F7931A' },
  { keys: ['meteora'], glyph: 'comet', accent: '#C264FF' },
  { keys: ['cashback'], glyph: 'cashback', accent: '#34D399' },
  { keys: ['credit kaspi', 'credit-kaspi'], glyph: 'card', accent: '#FF5A5F' },
  { keys: ['pay'], glyph: 'card', accent: '#22D3A0' },
  { keys: ['difinance'], glyph: 'wallet', accent: '#22D3A0' },
  { keys: ['sport-bet'], glyph: 'ball', accent: '#FF5A5F' },
  { keys: ['premium-channel'], glyph: 'crown', accent: '#FFB547' },
  { keys: ['plasma-kubok-live'], glyph: 'trophy', accent: '#FFC83D' },

  // Сайты и клиенты.
  { keys: ['alhamdulillah'], glyph: 'moon', accent: '#FFC83D' },
  { keys: ['eurasia'], glyph: 'globe', accent: '#2DD4BF' },
  { keys: ['forel'], glyph: 'fish', accent: '#38BDF8' },
  { keys: ['sky flame'], glyph: 'flame', accent: '#FF6B3D' },
  { keys: ['bishkek garden'], glyph: 'flower', accent: '#3DDC97' },
  { keys: ['bishkek garden demo', 'bishkek-garden-demo'], glyph: 'flower', accent: '#F472B6' },
  { keys: ['kvadrobanya-new'], glyph: 'droplets', accent: '#38BDF8' },
  { keys: ['kvadrobanya-old'], glyph: 'droplets', accent: '#2DD4BF' },
  { keys: ['эко ротанг', 'mebelsolnza'], glyph: 'chair', accent: '#FFB547' },
  { keys: ['sharmax', 'sharmax.com'], glyph: 'balloon', accent: '#FF7AB6' },
  { keys: ['cc moto', 'ccmoto.shop'], glyph: 'moto', accent: '#FF5A5F' },
  { keys: ['autoshop'], glyph: 'cart', accent: '#FFB547' },
  { keys: ['autoservice template', 'autoservice-template'], glyph: 'wrench', accent: '#FB923C' },
  { keys: ['bulls'], glyph: 'bull', accent: '#FF6B3D' },
  { keys: ['kuhnya'], glyph: 'pot', accent: '#FB923C' },
  { keys: ['jandamkrg'], glyph: 'heart', accent: '#F43F5E' },
  { keys: ['4pda'], glyph: 'phone', accent: '#3DDC97' },
  { keys: ['iphone-15-pro-max'], glyph: 'phone', accent: '#60A5FA' },
  { keys: ['archi'], glyph: 'building', accent: '#7DD3FC' },
  { keys: ['ai-landing'], glyph: 'browser', accent: '#4FD1FF' },
  { keys: ['site'], glyph: 'browser', accent: '#5EEAD4' },
  { keys: ['personal-site.invalid'], glyph: 'user', accent: '#38BDF8' },
  { keys: ['sergey'], glyph: 'user', accent: '#5EEAD4' },
  { keys: ['generate'], glyph: 'sparkles', accent: '#B67CFF' },
  { keys: ['generate v2', 'generate-v2'], glyph: 'sparkles', accent: '#A78BFA' },
  { keys: ['image-generate'], glyph: 'image', accent: '#FB923C' },
  { keys: ['facebook'], glyph: 'share', accent: '#3B82F6' },
  { keys: ['insta-comments'], glyph: 'message', accent: '#F472B6' },
  { keys: ['insta-kill'], glyph: 'ban', accent: '#F43F5E' },
  { keys: ['tiktok ads'], glyph: 'play', accent: '#F43F5E' },
  { keys: ['matreshka hero review', 'matreshka-hero-review'], glyph: 'doll', accent: '#F43F5E' },
  { keys: ['matreshka maf', 'matreshka-maf'], glyph: 'doll', accent: '#FF7AB6' },
  { keys: ['coords check', 'coords-check'], glyph: 'target', accent: '#3DDC97' },
  { keys: ['coords map', 'coords-map'], glyph: 'map', accent: '#38BDF8' },
  { keys: ['gora-academy'], glyph: 'mountain', accent: '#34D399' },
  { keys: ['travka'], glyph: 'leaf', accent: '#3DDC97' },
  { keys: ['kyc platform', 'kyc-platform'], glyph: 'idcard', accent: '#5EEAD4' },
  { keys: ['talent visa usa', 'talent-visa-usa'], glyph: 'passport', accent: '#3B82F6' },
  { keys: ['кп янкин', 'kp-yankin'], glyph: 'document', accent: '#FFB547' },
  { keys: ['договоры еврострой', 'dogovory-evrostroy'], glyph: 'contract', accent: '#7DD3FC' },
  { keys: ['freelance'], glyph: 'briefcase', accent: '#FFB547' },
];

const TABLE = new Map<string, TableEntry>();
for (const entry of PROJECT_TABLE) {
  for (const key of entry.keys) {
    if (!TABLE.has(key)) TABLE.set(key, entry);
  }
}

// Ключевые слова для проектов, которых нет в таблице (новые, у тиммейтов).
// Порядок важен: mazda раньше шин; широкие слова (видео, рилсы, бот) — в самом конце.
// `\b` в JS понимает только латиницу: границы кириллицы и `bot` прописаны руками.
const KEYWORD_RULES: Array<{ match: RegExp; glyph: NeonGlyph }> = [
  { match: /mazda|мазд/i, glyph: 'car' },
  { match: /tyres?|samruk|шин/i, glyph: 'tire' },
  { match: /consigliere|канцел/i, glyph: 'wallet' },
  { match: /claude\s*agent|cloudcli|neo3[-\s]*hub/i, glyph: 'neo3' },
  { match: /neo3-demo/i, glyph: 'play' },
  { match: /neo3-vpn|\bvpn\b/i, glyph: 'shield' },
  { match: /wh?isper|wisper/i, glyph: 'mic' },
  { match: /gora|гора/i, glyph: 'mountain' },
  { match: /пристав|pristav|долг|gosuslugi|помощник max/i, glyph: 'scale' },
  { match: /avito|авито/i, glyph: 'bag' },
  { match: /travka|травк|lfk/i, glyph: 'leaf' },
  { match: /karaoke|караоке|(^|\s)music(\s|$)/i, glyph: 'music' },
  { match: /alhamdulillah/i, glyph: 'moon' },
  { match: /difinance|финанс/i, glyph: 'wallet' },
  { match: /image-generate/i, glyph: 'image' },
  { match: /eurasia|еврази/i, glyph: 'globe' },
  { match: /agtest/i, glyph: 'flask' },
  { match: /archi/i, glyph: 'building' },
  { match: /crypto|крипт/i, glyph: 'coins' },
  { match: /(^|\s)demo(\s|$)/i, glyph: 'play' },
  { match: /dimasik/i, glyph: 'user' },
  { match: /facebook/i, glyph: 'share' },
  { match: /(^|\s)generate(\s|$)/i, glyph: 'sparkles' },
  { match: /gmap/i, glyph: 'map' },
  { match: /insta-comments/i, glyph: 'message' },
  { match: /insta-kill/i, glyph: 'ban' },
  { match: /insta/i, glyph: 'camera' },
  { match: /kvadro|баня/i, glyph: 'droplets' },
  { match: /matreshka|матр[её]шк/i, glyph: 'doll' },
  { match: /probe/i, glyph: 'wrench' },
  { match: /speedtest/i, glyph: 'gauge' },
  { match: /(^|\s)tmp(\s|$)/i, glyph: 'code' },
  { match: /(^|[^a-z])mcp([^a-z]|$)/i, glyph: 'chip' },
  { match: /trading|трейд/i, glyph: 'candles' },
  { match: /vault|obsidian|вольт/i, glyph: 'book' },
  { match: /(^|[^a-z])(shop|store)([^a-z]|$)|магазин/i, glyph: 'cart' },
  { match: /landing|(^|[^a-z])site([^a-z]|$)|сайт|лендинг/i, glyph: 'browser' },
  { match: /film|кино|video|видео/i, glyph: 'clapper' },
  { match: /reels|shorts|tiktok/i, glyph: 'play' },
  { match: /waba|whatsapp|вотсап|telegram|(^|[^a-z])bot([^a-z]|$)|(^|[^а-яё])бот/i, glyph: 'message' },
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/** Last non-empty path segment; both `/` and `\` separate. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * Presets look at the project name and its own folder name only: a project
 * that merely lives under `claude agent/`, `cloudcli/` or `/Users/dimasik/`
 * must not wear that folder's icon.
 */
export function resolveProjectIcon(name: string, path = ''): IconSpec {
  const folder = folderName(path);
  const entry = TABLE.get(normalize(name)) ?? (folder ? TABLE.get(normalize(folder)) : undefined);
  if (entry) {
    return { glyph: entry.glyph, accent: entry.accent, match: 'table' };
  }

  const accent = NEON_ACCENTS[hashString(`${name} ${path}`.toLowerCase()) % NEON_ACCENTS.length];
  const subject = `${name} ${folder}`;
  const rule = KEYWORD_RULES.find((candidate) => candidate.match.test(subject));
  if (rule) {
    return { glyph: rule.glyph, accent, match: 'keyword' };
  }

  return { glyph: 'folder', accent, match: 'fallback' };
}

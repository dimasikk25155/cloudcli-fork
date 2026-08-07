/**
 * Headless-съёмка интерфейса для проверки вёрстки и для презентационных кадров.
 *
 * Зачем: видимый браузер на этом маке отдаёт 2 FPS, когда его окно перекрыто
 * (macOS душит невидимые окна), и скриншоты отваливаются по таймауту. Headless
 * этим не страдает и заодно даёт стабильный кадр нужного размера.
 *
 * Запуск:
 *   AUTH_TOKEN=<jwt> node scripts/shoot-ui.mjs [--scale=150] [--theme=kineticType] [--out=dir]
 *
 * Токен берётся из localStorage залогиненного браузера (ключ `auth-token`).
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const BASE_URL = arg('url', 'http://100.96.100.39:3001');
const TOKEN = process.env.AUTH_TOKEN;
const SCALE = arg('scale', '100');
const THEME = arg('theme', '');
const LANG = arg('lang', '');
const OUT_DIR = path.resolve(arg('out', 'shots'));
const WIDTH = Number(arg('width', 1920));
const HEIGHT = Number(arg('height', 1080));

if (!TOKEN) {
  console.error('AUTH_TOKEN не задан. Возьми его из localStorage браузера (ключ auth-token).');
  process.exit(1);
}

const shots = [
  { name: '1-projects', prepare: async () => {} },
  {
    name: '2-settings-appearance',
    prepare: async (page) => {
      await page.locator('button:has-text("Settings"), button:has-text("Настройки")').first().click();
      await page.locator('button:has-text("Appearance"), button:has-text("Внешний вид")').first().click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: '3-settings-agents',
    prepare: async (page) => {
      await page.locator('button:has-text("Settings"), button:has-text("Настройки")').first().click();
      await page.locator('button:has-text("Agents"), button:has-text("Агенты")').first().click();
      await page.waitForTimeout(400);
    },
  },
];

await mkdir(OUT_DIR, { recursive: true });

// CHROME_PATH — на случай, когда установленная сборка Chromium не совпадает с
// той, которую ждёт локальная версия playwright (частый случай на этом маке).
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: Number(arg('dpr', 2)),
});

await context.addInitScript(
  ({ token, scale, theme, lang }) => {
    localStorage.setItem('auth-token', token);
    localStorage.setItem('uiScale', scale);
    if (theme) localStorage.setItem('appTheme', theme);
    if (lang) localStorage.setItem('userLanguage', lang);
  },
  { token: TOKEN, scale: SCALE, theme: THEME, lang: LANG },
);

for (const shot of shots) {
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  try {
    await shot.prepare(page);
  } catch (error) {
    console.warn(`${shot.name}: подготовка не удалась — ${error.message}`);
  }
  const file = path.join(OUT_DIR, `${shot.name}.png`);
  await page.screenshot({ path: file });
  console.log(`✓ ${file}`);
  await page.close();
}

await browser.close();

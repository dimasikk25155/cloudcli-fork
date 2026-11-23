// Pure parts of the preview stand: no processes, no files, no network.
// Everything here is covered by lib.test.mjs.
import path from 'node:path';

import {
  DEFAULT_WIDTH,
  FRAME_PATH,
  MAX_HEIGHT,
  MAX_PHONES,
  MAX_WIDTH,
  MAX_ZOOM,
  MIN_HEIGHT,
  MIN_WIDTH,
  MIN_ZOOM,
  isFrameHeight,
  isFrameId,
  isFramePath,
  isFrameWidth,
  isFrameZoom,
  parsePhoneToken,
} from './frame/frame-params.mjs';

/** The live Neo3 listens here; the stand never takes these, free or not. */
export const RESERVED_PORTS = Object.freeze([3001, 3005]);
export const PREFERRED_PORT = 3917;
export const PORT_SPAN = 50;
export const STAND_HOST = '127.0.0.1';

export const USAGE = [
  'node scripts/preview-stand/stand.mjs up | down | status | help',
  '',
  '  up [--port N] [--no-build] [--no-seed]',
  '        собрать клиент этой копии, поднять сервер с временным HOME и базой,',
  '        завести тестового пользователя и демо-проекты, напечатать адрес и ссылку рамки.',
  '        Стенд уже работает — пересобрать клиент (правки src/ видны после обновления страницы)',
  '        и напечатать те же адреса. Правки server/ — только down и снова up.',
  '  status  жив ли стенд и на каком порту',
  '  down    остановить сервер стенда и удалить его временную папку',
  '',
  'Рамка телефона: http://127.0.0.1:<порт>/stand/frame.html?<параметры>',
  '  w=390          ширина экрана телефона (390, 430; любое целое 320–1280)',
  '  h=844          высота; по умолчанию 844 для 390 и 932 для 430',
  '  theme=ember    тема одного телефона (id темы)',
  '  variant=city   вариант темы «Неон» (пишется в localStorage.neonVariant)',
  '  themes=ember,glass,neon:city',
  '                 до четырёх телефонов рядом, у каждого своя тема (вариант — после двоеточия)',
  '  path=/         путь приложения внутри рамки',
  '  zoom=fit       fit — уместить в окно; число 0.25–3 — свой масштаб (zoom=1 — точка в точку)',
  '  login=0        не входить (экран входа)',
  '  sync=0         тему записать только на «устройство», не в аккаунт',
  '  fresh=1        сначала очистить localStorage («новое устройство»)',
  'Страница готова, когда у <body> есть атрибут data-stand-ready; в data-stand-problems — число',
  'непринятых параметров и ошибок. Для browser.eval на странице есть window.stand:',
  '  stand.info()            по телефону: innerWidth, isMobile, theme, variant, dark, path',
  '  stand.click(selector)   нажать элемент в каждом телефоне; stand.clickText(текст) — по подписи',
  '  stand.point(selector, i) координаты элемента на странице — для browser.click {x, y}',
  '  stand.doc(i), stand.win(i), stand.each((doc, win, i) => …) — документ и окно телефона',
  '',
  'Чего рамка не показывает (это не айфон): размытие под стеклом — встроенный браузер не рисует',
  '  backdrop-filter в снимок, виден только цвет и прозрачность слоя; вырез и нижняя полоса',
  '  (safe-area = 0); клавиатура; режим «с домашнего экрана». Полосы прокрутки спрятаны, как на телефоне.',
].join('\n');

const isUserPort = (value) => Number.isInteger(value) && value >= 1024 && value <= 65535;

const reservedPortMessage = (port) =>
  `Порт ${port} занят боевым Neo3 (${RESERVED_PORTS.join(', ')} — чужие): выбери другой.`;

/** `argv` without `node` and the script path. Throws an Error with a message for the person. */
export function parseArgs(argv) {
  const [word, ...rest] = argv;
  const command = word === '--help' || word === '-h' ? 'help' : word;
  if (!['up', 'down', 'status', 'help'].includes(command)) {
    throw new Error(`Нужна команда: up | down | status | help.\n\n${USAGE}`);
  }

  const options = { command, port: null, build: true, seed: true };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--no-build') {
      options.build = false;
    } else if (arg === '--no-seed') {
      options.seed = false;
    } else if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = arg === '--port' ? rest[(index += 1)] : arg.slice('--port='.length);
      const port = /^\d+$/.test(raw ?? '') ? Number.parseInt(raw, 10) : Number.NaN;
      if (!isUserPort(port)) {
        throw new Error(`--port ждёт число от 1024 до 65535, получено: ${raw ?? 'ничего'}.`);
      }
      if (RESERVED_PORTS.includes(port)) {
        throw new Error(reservedPortMessage(port));
      }
      options.port = port;
    } else {
      throw new Error(`Не знаю параметр ${arg}.\n\n${USAGE}`);
    }
  }
  return options;
}

/**
 * First port from `preferred` upwards that is not reserved and that `isFree`
 * confirms. `isFree(port) → Promise<boolean>` is the only thing that touches the network.
 */
export async function pickPort({ preferred = PREFERRED_PORT, span = PORT_SPAN, reserved = RESERVED_PORTS, isFree }) {
  const last = preferred + span - 1;
  for (let port = preferred; port <= last; port += 1) {
    if (reserved.includes(port)) {
      continue;
    }
    if (await isFree(port)) {
      return port;
    }
  }
  throw new Error(`Свободного порта нет в диапазоне ${preferred}–${last}. Задай свой: --port N.`);
}

/**
 * Ready link of the phone frame. Takes the same parameters the frame page reads
 * (frame/frame-params.mjs) and refuses the ones the page would drop.
 */
export function buildFrameUrl({ port, width = DEFAULT_WIDTH, height, theme, variant, themes, path: appPath, zoom, login, sync, fresh }) {
  if (!isFrameWidth(width)) {
    throw new Error(`w=${width}: ширина рамки — целое от ${MIN_WIDTH} до ${MAX_WIDTH}.`);
  }
  const query = new URLSearchParams({ w: String(width) });
  if (height !== undefined) {
    if (!isFrameHeight(height)) {
      throw new Error(`h=${height}: высота рамки — целое от ${MIN_HEIGHT} до ${MAX_HEIGHT}.`);
    }
    query.set('h', String(height));
  }
  for (const [name, value] of [['theme', theme], ['variant', variant]]) {
    if (value === undefined || value === null) {
      continue;
    }
    if (!isFrameId(value)) {
      throw new Error(`${name}=${value}: нужен id латиницей без пробелов (ember, neon, city).`);
    }
    query.set(name, value);
  }
  if (themes !== undefined) {
    if (theme !== undefined || variant !== undefined) {
      throw new Error('themes задаёт все телефоны сразу: theme и variant рядом с ним не нужны (вариант — «neon:city»).');
    }
    const bad = themes.find((token) => !parsePhoneToken(token));
    if (bad !== undefined || themes.length === 0 || themes.length > MAX_PHONES) {
      throw new Error(`themes: от 1 до ${MAX_PHONES} записей вида ember или neon:city${bad === undefined ? '' : `, не подошло: ${bad}`}.`);
    }
    query.set('themes', themes.join(','));
  }
  if (appPath !== undefined && appPath !== null) {
    if (!isFramePath(appPath)) {
      throw new Error(`path=${appPath}: нужен путь приложения с «/» в начале, без адреса сайта.`);
    }
    query.set('path', appPath);
  }
  if (zoom !== undefined && zoom !== 'fit') {
    if (!isFrameZoom(zoom)) {
      throw new Error(`zoom=${zoom}: масштаб — fit или число от ${MIN_ZOOM} до ${MAX_ZOOM}.`);
    }
    query.set('zoom', String(zoom));
  }
  if (login === false) {
    query.set('login', '0');
  }
  if (sync === false) {
    query.set('sync', '0');
  }
  if (fresh === true) {
    query.set('fresh', '1');
  }
  return `http://${STAND_HOST}:${port}${FRAME_PATH}?${query}`;
}

/**
 * What the stand server inherits from the shell. Everything else — tokens,
 * the live DATABASE_PATH, CODEX_HOME, the flag that makes a server register
 * itself in ~/.claude.json — stays behind.
 */
const INHERITED_ENV = ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SHELL', 'USER', 'LOGNAME', 'TZ'];

/** Background loops of the server that talk to Telegram, VPS and the Mac itself. */
const SWITCHED_OFF = [
  'NEO3_KRABIK_WATCH',
  'NEO3_DUET_WATCH',
  'NEO3_BRIDGE_WATCH',
  'NEO3_AGENT_QUEUE_WATCH',
  'NEO3_SCHEDULE_NOTIFY_WATCH',
  'NEO3_MEMORY_SUGGESTIONS',
];

const withoutTrailingSlash = (value) => (value.length > 1 ? value.replace(/\/+$/, '') : value);

/**
 * Environment of the stand server. Throws instead of returning an environment
 * that would let the server write into the real home: without a scratch HOME it
 * overwrites the live `~/.cloudcli/local-server.json`.
 */
export function buildServerEnv({ baseEnv, home, port, realHome }) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) {
    throw new Error(`HOME стенда должен быть абсолютным путём, получено: ${home}.`);
  }
  const scratchHome = withoutTrailingSlash(path.normalize(home));
  const liveHome = withoutTrailingSlash(path.normalize(realHome));
  if (scratchHome === liveHome) {
    throw new Error('HOME стенда совпал с настоящим домашним каталогом — сервер перезаписал бы боевые файлы.');
  }
  const liveData = path.join(liveHome, '.cloudcli');
  if (scratchHome === liveData || scratchHome.startsWith(`${liveData}${path.sep}`)) {
    throw new Error('HOME стенда лежит внутри боевого ~/.cloudcli — так нельзя.');
  }
  if (!isUserPort(port)) {
    throw new Error(`Порт стенда — число от 1024 до 65535, получено: ${port}.`);
  }
  if (RESERVED_PORTS.includes(port)) {
    throw new Error(reservedPortMessage(port));
  }

  const env = {};
  for (const name of INHERITED_ENV) {
    if (typeof baseEnv[name] === 'string' && baseEnv[name] !== '') {
      env[name] = baseEnv[name];
    }
  }
  for (const name of SWITCHED_OFF) {
    env[name] = 'off';
  }
  const schedules = path.join(scratchHome, 'schedules');
  return {
    ...env,
    HOME: scratchHome,
    USERPROFILE: scratchHome,
    DATABASE_PATH: path.join(scratchHome, '.cloudcli', 'auth.db'),
    SERVER_PORT: String(port),
    HOST: STAND_HOST,
    // With a schedule folder set the server skips launchctl altogether.
    NEO3_SCHEDULE_DIR: schedules,
    NEO3_SCHEDULE_LOG_DIR: path.join(schedules, 'logs'),
  };
}

/**
 * `state` — what `up` wrote down (or null), `pidAlive` — our server process
 * exists, `healthy` — the port answers as the stand.
 */
export function standStatus({ state, pidAlive, healthy }) {
  if (!state) {
    return 'stopped';
  }
  if (!pidAlive) {
    return 'stale';
  }
  return healthy ? 'running' : 'starting';
}

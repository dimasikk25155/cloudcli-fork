// Phone frame of the preview stand. Served from the stand's own origin, so the
// app inside each <iframe> shares localStorage with this page: the frame signs
// the test user in and sets the theme before the app loads.
//
// Several phones (`themes=ember,glass,neon:city`) are loaded one after another:
// the app reads its theme once at start and then keeps it in memory, so every
// phone stays in the theme that was stored when it loaded.
import { normalizeFrameParams } from './frame-params.mjs';

const params = normalizeFrameParams(window.location.search);
const stage = document.getElementById('stage');
const info = document.getElementById('info');
const facts = document.getElementById('facts');
const problemList = document.getElementById('problems');
const problems = [...params.problems.map((problem) => `Параметр не принят: ${problem}`)];

const STAGE_PADDING = 8;
const COLUMN_GAP = 12;
const LABEL_HEIGHT = 18;
/** The app asks the server for its settings right after it mounts; give that request time to land. */
const THEME_SETTLE_MS = 1500;

/**
 * An iPhone draws scrollbars over the content. The built-in WebKit browser on a
 * Mac gives every scrolling box a classic 17 px bar instead, and each screen
 * would measure that much narrower than on the phone.
 */
// Both forms: the app sets `scrollbar-color` on dark themes, and WebKit then ignores `::-webkit-scrollbar`.
const PHONE_SCROLLBARS = '* { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Applied on every load of the frame: a reload inside the phone starts a new document. */
function keepPhoneScrollbars(frame) {
  frame.addEventListener('load', () => {
    const style = frame.contentDocument.createElement('style');
    style.dataset.stand = 'phone-scrollbars';
    style.textContent = PHONE_SCROLLBARS;
    frame.contentDocument.head.append(style);
  });
}

function showFacts(rows) {
  facts.replaceChildren(
    ...rows.flatMap(([name, value]) => {
      const term = document.createElement('dt');
      term.textContent = name;
      const description = document.createElement('dd');
      description.textContent = value;
      return [term, description];
    }),
  );
}

function showProblems() {
  problemList.replaceChildren(
    ...problems.map((problem) => {
      const item = document.createElement('li');
      item.textContent = problem;
      return item;
    }),
  );
  document.body.dataset.standProblems = String(problems.length);
}

/** Every phone keeps its own layout size; a small window only shrinks the picture. */
function pickScale() {
  if (params.zoom !== 'fit') {
    return params.zoom;
  }
  const count = params.phones.length;
  const heightRoom = window.innerHeight - STAGE_PADDING * 2 - LABEL_HEIGHT;
  const widthRoom = window.innerWidth - STAGE_PADDING * 2 - COLUMN_GAP * (count - 1);
  return Math.min(1, heightRoom / params.height, widthRoom / (params.width * count));
}

function describePhone(phone) {
  if (!phone.theme) {
    return 'тема как сохранена';
  }
  return phone.variant ? `${phone.theme} · ${phone.variant}` : phone.theme;
}

function addPhone(phone, scale) {
  const column = document.createElement('div');
  column.className = 'phone-column';
  const label = document.createElement('div');
  label.className = 'phone-label';
  label.textContent = `${describePhone(phone)} · ${params.width} × ${params.height}`;
  const box = document.createElement('div');
  box.className = 'phone-box';
  box.style.width = `${params.width * scale}px`;
  box.style.height = `${params.height * scale}px`;
  const frame = document.createElement('iframe');
  frame.title = `Neo3 на телефоне: ${describePhone(phone)}`;
  frame.style.width = `${params.width}px`;
  frame.style.height = `${params.height}px`;
  if (scale !== 1) {
    frame.style.transform = `scale(${scale})`;
  }
  keepPhoneScrollbars(frame);
  box.append(frame);
  column.append(label, box);
  column.style.width = box.style.width;
  stage.insertBefore(column, info);
  return frame;
}

async function signIn() {
  if (!params.login) {
    localStorage.removeItem('auth-token');
    return null;
  }
  const response = await fetch('./session.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Нет файла входа стенда (код ${response.status}) — выполни stand.mjs up ещё раз.`);
  }
  const session = await response.json();
  localStorage.setItem('auth-token', session.token);
  return session.token;
}

async function storeTheme(phone, token) {
  if (phone.variant) {
    localStorage.setItem('neonVariant', phone.variant);
  }
  if (!phone.theme) {
    return;
  }
  localStorage.setItem('appTheme', phone.theme);
  // Left over from the previous theme, they would paint the first frame in its colours.
  localStorage.removeItem('shaderVariant');
  localStorage.removeItem('appThemeColor');
  if (!params.sync || !token) {
    return;
  }
  const response = await fetch('/api/settings/ui-preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ theme: phone.theme }),
  });
  if (!response.ok) {
    throw new Error(`Тема ${phone.theme} не записана в аккаунт (код ${response.status}).`);
  }
}

function loadApp(frame) {
  return new Promise((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.src = params.path;
  });
}

/**
 * Helpers for `browser.eval`. Calls without an index act on every phone and
 * return an array, one item per phone.
 */
function exposeHelpers(frames, scale) {
  const doc = (index = 0) => frames[index].contentDocument;
  const win = (index = 0) => frames[index].contentWindow;
  const each = (action) => frames.map((frame, index) => action(frame.contentDocument, frame.contentWindow, index));
  const clickIn = (find) => each((document_) => {
    const element = find(document_);
    if (!element) {
      return false;
    }
    element.click();
    return true;
  });

  window.stand = {
    params,
    scale,
    frames,
    doc,
    win,
    each,
    info: () => each((document_, window_) => {
      const root = document_.documentElement;
      return {
        innerWidth: window_.innerWidth,
        innerHeight: window_.innerHeight,
        isMobile: window_.innerWidth < 768,
        theme: root.getAttribute('data-theme'),
        variant: root.getAttribute('data-theme-variant'),
        dark: root.classList.contains('dark'),
        path: `${window_.location.pathname}${window_.location.search}`,
      };
    }),
    click: (selector) => clickIn((document_) => document_.querySelector(selector)),
    clickText: (text) => clickIn((document_) => {
      const candidates = [...document_.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"]')];
      return candidates.find((candidate) => candidate.textContent.trim() === text)
        ?? candidates.find((candidate) => candidate.textContent.includes(text));
    }),
    /** Centre of an element in the coordinates of this page — for `browser.click {x, y}`. */
    point(selector, index = 0) {
      const element = doc(index).querySelector(selector);
      if (!element) {
        return null;
      }
      const inner = element.getBoundingClientRect();
      const outer = frames[index].getBoundingClientRect();
      return {
        x: Math.round(outer.left + (inner.left + inner.width / 2) * scale),
        y: Math.round(outer.top + (inner.top + inner.height / 2) * scale),
      };
    },
  };
}

async function start() {
  const scale = pickScale();
  document.body.dataset.standPhones = String(params.phones.length);
  showFacts([
    ['Экран', `${params.width} × ${params.height}${scale === 1 ? '' : `, показан в масштабе ${scale.toFixed(2)}`}`],
    ['Темы', params.phones.map(describePhone).join(', ')],
    ['Путь', params.path],
    ['Вход', params.login ? 'тестовый пользователь' : 'без входа'],
    ['Не видно', 'размытие под стеклом, вырез и нижняя полоса айфона, клавиатура'],
  ]);
  const frames = params.phones.map((phone) => addPhone(phone, scale));
  exposeHelpers(frames, scale);

  if (params.fresh) {
    localStorage.clear();
  }
  let token = null;
  try {
    token = await signIn();
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  for (const [index, phone] of params.phones.entries()) {
    try {
      await storeTheme(phone, token);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    await loadApp(frames[index]);
    if (index < params.phones.length - 1) {
      await sleep(THEME_SETTLE_MS);
    }
  }

  showProblems();
  document.body.dataset.standReady = '1';
}

start();

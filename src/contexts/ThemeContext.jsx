import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

import { authenticatedFetch } from '../utils/api';
import { applyTweaks, parseTweakMap } from '../utils/themeTweaks';

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
  'glass',
  'ember',
  'gt',
  'editorial',
  'kineticType',
  'claude',
  'neonCity',
  'synthwaveDrive',
  'nebulaFlow',
  'missionControl',
  'bento3d',
  'liquidChrome',
  'zenParticles',
];

// Тема по умолчанию для новых установок. У существующих пользователей выбор
// хранится в аккаунте и не трогается — см. начальное состояние `theme` ниже.
// Там же лечится удалённая тема: ключа больше нет в THEMES, поэтому проверка
// `THEMES.includes` сама откатывает такого пользователя на дефолт, а не
// оставляет его с пустым оформлением.
export const DEFAULT_THEME = 'glass';

// Human-readable labels for the theme picker in Settings → Appearance.
// Названия по ЦВЕТУ АКЦЕНТА, а не по образу: «Стекло» и «Гонка» ничего не
// говорили о том, как тема выглядит, и выбирать приходилось перебором. Теперь
// подпись = цвет кнопок и ссылок, у двух светлых тем это помечено отдельно.
// Ключи менять нельзя — они лежат в аккаунтах и в именах CSS-блоков и фонов.
export const THEME_LABELS = {
  glass: 'Бирюзовая светлая',
  ember: 'Оранжевая',
  gt: 'Красная',
  editorial: 'Бежевая светлая',
  kineticType: 'Лаймовая',
  claude: 'Терракотовая',
  neonCity: 'Голубая',
  synthwaveDrive: 'Розовая',
  nebulaFlow: 'Мятная',
  missionControl: 'Синяя',
  bento3d: 'Зелёная',
  liquidChrome: 'Сиреневая',
  zenParticles: 'Янтарная',
};

// Themes that are light (bright) rather than dark. Each theme decides whether
// the global `dark` class is applied — there is no separate user dark/light
// toggle. `default` and anything not listed here is treated as dark.
export const LIGHT_THEMES = ['editorial', 'glass'];

// Несколько картинок на одну тему: тема задаёт цвета/шрифты/панели, а фон
// внутри неё выбирается отдельно. Первый вариант в списке — дефолтный, его
// файл называется просто `<тема>.jpg` (так же, как у тем с одним фоном),
// остальные — `<тема>-<id>.jpg`. Тема без записи здесь = один фон, и селектор
// картинки для неё не показывается.
export const THEME_BACKGROUNDS = {
  kineticType: [
    { id: 'corridor', label: 'Коридор' },
    { id: 'kinetic', label: 'Скорость' },
    { id: 'wireframe', label: 'Чертёж' },
    { id: 'chrome', label: 'Хром' },
    { id: 'slab', label: 'Плита' },
  ],
};

/** Варианты фона для темы (пустой массив = выбирать не из чего). */
export const backgroundsForTheme = (themeKey) => THEME_BACKGROUNDS[themeKey] || [];

/** Файл фона: дефолтный вариант живёт под именем самой темы. */
export const backgroundFile = (themeKey, variantId) => {
  const variants = backgroundsForTheme(themeKey);
  const fallback = variants[0]?.id;
  const active = variants.some((variant) => variant.id === variantId) ? variantId : fallback;
  return !active || active === fallback
    ? `/theme-bg/${themeKey}.jpg`
    : `/theme-bg/${themeKey}-${active}.jpg`;
};

// Масштаб интерфейса в процентах. Всё приложение свёрстано в rem, поэтому
// корневой font-size тянет за собой и текст, и отступы, и иконки — в отличие от
// зума браузера, который на скриншотах даёт замыленные границы и рвёт фиксы.
// Нужен на проекторе (зал читает с задних рядов) и на больших мониторах.
export const UI_SCALES = [100, 125, 150, 175];
export const DEFAULT_UI_SCALE = 100;
const BASE_ROOT_FONT_SIZE_PX = 16;

// Backwards-compatible aliases (older code referred to these as shader variants).
export const SHADER_VARIANTS = THEMES;
export const SHADER_VARIANT_LABELS = THEME_LABELS;

/** Разбор сохранённой карты «тема → выбранный фон» (localStorage или сервер). */
const parseBackgroundMap = (raw) => {
  if (typeof raw !== 'string' || !raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(([themeKey, variantId]) =>
        typeof variantId === 'string'
        && backgroundsForTheme(themeKey).some((variant) => variant.id === variantId)
      )
    );
  } catch {
    return {};
  }
};

export const ThemeProvider = ({ children }) => {
  // Показывать ли фон вообще (opt-out). Историческое имя ключа `shaderBg`
  // осталось с тех пор, когда фон был только WebGL-шейдером — не переименовано,
  // чтобы у существующих пользователей не сбросился их выбор.
  const [shaderEnabled, setShaderEnabledRaw] = useState(() => {
    const saved = localStorage.getItem('shaderBg');
    return saved === null ? true : saved === 'on';
  });
  // Какая картинка выбрана внутри темы: { [themeKey]: variantId }. Хранится
  // по темам, чтобы выбор не слетал при переключении туда-обратно.
  const [themeBackgrounds, setThemeBackgroundsRaw] = useState(
    () => parseBackgroundMap(localStorage.getItem('themeBackgrounds'))
  );
  // Ручная подстройка тем: { [themeKey]: { radius, fontUi, blur, … } }. Живёт
  // рядом с themeBackgrounds и по тем же правилам — localStorage для мгновенной
  // отрисовки, аккаунт для переноса между устройствами.
  const [themeTweaks, setThemeTweaksRaw] = useState(
    () => parseTweakMap(localStorage.getItem('themeTweaks'))
  );
  const [uiScale, setUiScaleRaw] = useState(() => {
    const saved = Number(localStorage.getItem('uiScale'));
    return UI_SCALES.includes(saved) ? saved : DEFAULT_UI_SCALE;
  });
  const [theme, setThemeRaw] = useState(() => {
    const saved = localStorage.getItem('appTheme') || localStorage.getItem('shaderVariant');
    return THEMES.includes(saved) ? saved : DEFAULT_THEME;
  });
  // Своя картинка фона: флаг «загружена» синкается через настройки аккаунта,
  // сам файл лежит на сервере. `customBackgroundVersion` растёт при каждой
  // перезаписи — иначе браузер показал бы старую картинку из кэша.
  const [customBackground, setCustomBackgroundRaw] = useState(
    () => localStorage.getItem('customBackground') === 'on'
  );
  const [customBackgroundVersion, setCustomBackgroundVersion] = useState(0);
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState(null);

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
        const {
          theme: savedTheme,
          shaderEnabled: savedShaderEnabled,
          uiScale: savedUiScale,
          themeBackgrounds: savedBackgrounds,
        } = data.preferences;
        if (typeof savedTheme === 'string' && THEMES.includes(savedTheme)) {
          setThemeRaw(savedTheme);
        }
        if (typeof savedShaderEnabled === 'boolean') {
          setShaderEnabledRaw(savedShaderEnabled);
        }
        if (UI_SCALES.includes(Number(savedUiScale))) {
          setUiScaleRaw(Number(savedUiScale));
        }
        const backgrounds = parseBackgroundMap(savedBackgrounds);
        if (Object.keys(backgrounds).length > 0) {
          setThemeBackgroundsRaw(backgrounds);
        }
        const tweaks = parseTweakMap(data.preferences.themeTweaks);
        if (Object.keys(tweaks).length > 0) {
          setThemeTweaksRaw(tweaks);
        }
        if (typeof data.preferences.customBackground === 'boolean') {
          setCustomBackgroundRaw(data.preferences.customBackground);
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

  useEffect(() => {
    localStorage.setItem('themeBackgrounds', JSON.stringify(themeBackgrounds));
  }, [themeBackgrounds]);

  // Картинка фона отдаётся с авторизацией, поэтому в CSS `url()` её не
  // подставить: тянем блобом и живём на object-URL, как чат делает с
  // вложениями. Старый URL обязательно отзываем, иначе утечёт память.
  useEffect(() => {
    localStorage.setItem('customBackground', customBackground ? 'on' : 'off');
    if (!customBackground) {
      setCustomBackgroundUrl(null);
      return undefined;
    }

    let cancelled = false;
    let objectUrl = null;
    authenticatedFetch('/api/settings/ui-preferences/background')
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setCustomBackgroundUrl(objectUrl);
      })
      .catch((error) => {
        console.warn('Failed to load custom background:', error);
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [customBackground, customBackgroundVersion]);

  // Масштаб задаём корневым font-size: вся вёрстка в rem подхватывает его сама.
  useEffect(() => {
    document.documentElement.style.fontSize = `${(BASE_ROOT_FONT_SIZE_PX * uiScale) / 100}px`;
    localStorage.setItem('uiScale', String(uiScale));
  }, [uiScale]);

  // The active theme drives both its `data-theme` attribute and the global
  // `dark` class + browser chrome, so light themes flip everything at once.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('appTheme', theme);
    // Ручная подстройка хранится по темам — снимаем чужую, накладываем свою.
    applyTweaks(theme, themeTweaks);

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
    // themeTweaks в зависимостях: без него ползунок применялся бы только при
    // следующей смене темы, то есть «ничего не происходит».
  }, [theme, themeTweaks]);

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

  // Подстройка одной темы. Пустой объект убирает тему из карты целиком, иначе
  // «сброс» оставлял бы за собой мусор вида {"glass":{}} и синкал его.
  const tweakSyncTimer = useRef(null);
  const setThemeTweaks = (themeKey, tweaks) => {
    const next = { ...themeTweaks };
    if (!tweaks || Object.keys(tweaks).length === 0) {
      delete next[themeKey];
    } else {
      next[themeKey] = tweaks;
    }
    setThemeTweaksRaw(next);
    const serialized = JSON.stringify(next);
    localStorage.setItem('themeTweaks', serialized);
    // Ползунок отдаёт значение на КАЖДЫЙ кадр перетаскивания, а пресет —
    // ещё и на каждый кадр анимации. Без задержки это десятки PUT в секунду;
    // аккаунту нужно только то значение, на котором палец остановился.
    // Локальное состояние и localStorage при этом обновляются сразу, поэтому
    // картинка не ждёт сеть.
    if (tweakSyncTimer.current) {
      clearTimeout(tweakSyncTimer.current);
    }
    tweakSyncTimer.current = setTimeout(() => {
      authenticatedFetch('/api/settings/ui-preferences', {
        method: 'PUT',
        // Карта уезжает строкой: сервер хранит только плоские значения.
        body: JSON.stringify({ themeTweaks: serialized }),
      }).catch((error) => {
        console.warn('Failed to sync theme tweaks to account:', error);
      });
    }, 400);
  };

  const setThemeBackground = (themeKey, variantId) => {
    const next = { ...themeBackgrounds, [themeKey]: variantId };
    setThemeBackgroundsRaw(next);
    authenticatedFetch('/api/settings/ui-preferences', {
      method: 'PUT',
      // Карта уезжает строкой: сервер хранит только плоские значения.
      body: JSON.stringify({ themeBackgrounds: JSON.stringify(next) }),
    }).catch((error) => {
      console.warn('Failed to sync theme background preference to account:', error);
    });
  };

  /**
   * Заливает картинку с устройства и включает свой фон. Возвращает промис,
   * чтобы кнопка в настройках могла показать ошибку словами, а не молча
   * ничего не сделать.
   */
  const uploadCustomBackground = async (file) => {
    const form = new FormData();
    form.append('background', file);
    const response = await authenticatedFetch('/api/settings/ui-preferences/background', {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Не удалось загрузить фон');
    }
    setCustomBackgroundRaw(true);
    setCustomBackgroundVersion((version) => version + 1);
    authenticatedFetch('/api/settings/ui-preferences', {
      method: 'PUT',
      body: JSON.stringify({ customBackground: true }),
    }).catch((error) => {
      console.warn('Failed to sync custom background flag to account:', error);
    });
  };

  /** Возвращает штатный фон темы: файл на сервере удаляется, флаг гаснет. */
  const clearCustomBackground = async () => {
    await authenticatedFetch('/api/settings/ui-preferences/background', { method: 'DELETE' })
      .catch((error) => {
        console.warn('Failed to delete custom background:', error);
      });
    setCustomBackgroundRaw(false);
    authenticatedFetch('/api/settings/ui-preferences', {
      method: 'PUT',
      body: JSON.stringify({ customBackground: false }),
    }).catch((error) => {
      console.warn('Failed to sync custom background flag to account:', error);
    });
  };

  const setUiScale = (next) => {
    const normalized = UI_SCALES.includes(Number(next)) ? Number(next) : DEFAULT_UI_SCALE;
    setUiScaleRaw(normalized);
    authenticatedFetch('/api/settings/ui-preferences', {
      method: 'PUT',
      body: JSON.stringify({ uiScale: normalized }),
    }).catch((error) => {
      console.warn('Failed to sync UI scale preference to account:', error);
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
    // Выбор картинки внутри темы.
    themeBackgrounds,
    setThemeBackground,
    backgroundVariant: themeBackgrounds[theme] || backgroundsForTheme(theme)[0]?.id,
    // Ручная подстройка темы (панель твиков).
    themeTweaks,
    setThemeTweaks,
    activeTweaks: themeTweaks[theme] || {},
    // Свой фон с устройства.
    customBackground,
    customBackgroundUrl,
    uploadCustomBackground,
    clearCustomBackground,
    // Масштаб интерфейса (проектор, большие экраны).
    uiScale,
    setUiScale,
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

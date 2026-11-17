/**
 * Сторож моста: раз в 30 с читает быстрый статус пульта и пишет Диме,
 * когда мост сменил путь, лёг целиком (дольше 2 мин), выключен или ожил.
 * Ночью тоже — это авария. Каждый вид сообщения не чаще раза в 10 минут.
 * Первый проход после старта Neo3 только запоминает состояние.
 * Логика здесь без сети и файлов; боевые зависимости — bridge.runtime.ts.
 */

import type { BridgeStatus } from './bridge.service.js';

export type BridgeNoticeKind = 'switched' | 'returned' | 'down' | 'off' | 'up';

export type BridgeNotice = { kind: BridgeNoticeKind; title: string; body: string };

export type BridgeWatchDeps = {
  status: () => Promise<BridgeStatus | null>;
  notify: (notice: BridgeNotice) => Promise<void>;
  isOn: () => boolean;
  now?: () => number;
};

export const DOWN_AFTER_MS = 2 * 60_000;
export const REPEAT_MS = 10 * 60_000;
const PRIMARY = 'mitya';

const TITLE: Record<string, string> = {
  mitya: 'сервер Мити',
  'vps-ts': 'мой VPS',
  'vps-pub': 'мой VPS (публичный адрес)',
};

function routeTitle(route: string | null): string {
  return (route && TITLE[route]) || route || '—';
}

function sameFamily(a: string | null, b: string | null): boolean {
  const family = (route: string | null) => (route && route.startsWith('vps') ? 'vps' : route);
  return family(a) === family(b);
}

export function createBridgeWatch(deps: BridgeWatchDeps) {
  const now = deps.now ?? Date.now;
  let started = false;
  let lastRoute: string | null = null;
  let badSince: number | null = null;
  let alarmed: 'down' | 'off' | null = null;
  const sentAt = new Map<BridgeNoticeKind, number>();

  async function send(notice: BridgeNotice): Promise<void> {
    const at = sentAt.get(notice.kind);
    if (at !== undefined && now() - at < REPEAT_MS) return;
    sentAt.set(notice.kind, now());
    await deps.notify(notice);
  }

  async function tick(): Promise<void> {
    if (!deps.isOn()) return;
    const status = await deps.status();
    if (!status) return;
    const healthy = status.installed && status.exit_ok;
    const route = healthy ? status.route : null;

    if (!started) {
      started = true;
      lastRoute = route;
      badSince = healthy ? null : now();
      return;
    }

    if (!healthy) {
      badSince = badSince ?? now();
      if (now() - badSince >= DOWN_AFTER_MS) {
        const kind = status.installed ? 'down' : 'off';
        if (alarmed !== kind) {
          alarmed = kind;
          await send(kind === 'off'
            ? {
              kind: 'off',
              title: 'Мост выключен',
              body: 'Агенты выходят с IP мака, а не с общего 45.86.61.144 — риск для общей с Митей подписки. '
                + 'Вернуть — «Вернуть мост» в «Пульте моста» на маке.',
            }
            : {
              kind: 'down',
              title: 'Мост лёг',
              body: 'Ни один путь до 45.86.61.144 не отвечает больше 2 минут — агенты стоят. '
                + 'Нажми «Починить». Если лёг сервер Мити, кнопки здесь могут не ответить '
                + '(claude.neo3.ru идёт через него) — тогда «Пульт моста» на маке или «Запасной агент».',
            });
        }
      }
      return;
    }

    // Работает.
    badSince = null;
    if (alarmed) {
      alarmed = null;
      lastRoute = route;
      await send({ kind: 'up', title: 'Мост снова работает', body: `Сейчас через «${routeTitle(route)}».` });
      return;
    }
    if (route && lastRoute && !sameFamily(route, lastRoute)) {
      const back = route === PRIMARY;
      await send(back
        ? { kind: 'returned', title: 'Мост вернулся на основной путь', body: 'Снова через сервер Мити.' }
        : {
          kind: 'switched',
          title: 'Мост перешёл на запасной путь',
          body: `${routeTitle(lastRoute)} не отвечал — теперь через «${routeTitle(route)}». `
            + 'Агенты работают, выход прежний (45.86.61.144). На основной вернётся сам.',
        });
    }
    if (route) lastRoute = route;
  }

  return { tick };
}

/**
 * «Прислать итог» of schedules. The OS runner works outside the server (and
 * while it is down), so a push from there is unreliable: the runner only writes
 * `last_run_at` / `last_status` / `last_result`, and this watch inside the
 * server sends every run newer than `notified_at` once — push + Telegram.
 */

import { schedulesDb, type ScheduleRow } from '@/modules/database/index.js';

export const SCHEDULE_NOTICE_CODE = 'schedule.result';
const TICK_MS = 60_000;
const FIRST_TICK_MS = 10_000;

export type ScheduleNotice = {
  code: 'schedule.result';
  userId: number;
  scheduleId: number;
  title: string;
  body: string;
  ok: boolean;
};

export type ScheduleResultWatchDependencies = {
  notify: (notice: ScheduleNotice) => void | Promise<void>;
};

export function scheduleNoticeOf(row: ScheduleRow): ScheduleNotice {
  const ok = row.last_status === 'ok';
  const result = (row.last_result ?? '').trim();
  const body = ok
    ? result || 'Готово'
    : `Ошибка: ${result || row.last_status || 'без текста'}`;
  return {
    code: 'schedule.result',
    userId: row.user_id,
    scheduleId: row.id,
    title: `Расписание «${row.name}»`,
    body,
    ok,
  };
}

export function createScheduleResultWatch(dependencies: ScheduleResultWatchDependencies) {
  /** Sends every unsent result once; returns how many were sent. */
  async function tick(): Promise<number> {
    let sent = 0;
    for (const row of schedulesDb.listToNotify()) {
      // Marked first: a failing channel must not resend the same run every minute.
      schedulesDb.markNotified(row.id, row.last_run_at);
      try {
        await dependencies.notify(scheduleNoticeOf(row));
        sent += 1;
      } catch (error) {
        console.error('[schedules] result notice failed', error instanceof Error ? error.message : String(error));
      }
    }
    return sent;
  }

  return { tick };
}

let timer: NodeJS.Timeout | null = null;
let busy = false;

/** Started in `server.listen`; `NEO3_SCHEDULE_NOTIFY_WATCH=off` keeps it still. */
export function startScheduleResultWatch(): void {
  if (timer || process.env.NEO3_SCHEDULE_NOTIFY_WATCH === 'off') return;
  const watch = createScheduleResultWatch({
    notify: async (notice) => {
      const { sendOwnerNotice } = await import('@/modules/notifications/index.js');
      await sendOwnerNotice({
        userId: notice.userId,
        code: notice.code,
        title: notice.title,
        body: notice.body,
        severity: notice.ok ? 'info' : 'warning',
        meta: { scheduleId: notice.scheduleId },
        icon: notice.ok ? '🗓️' : '⚠️',
      });
    },
  });
  const once = () => {
    if (busy) return;
    busy = true;
    void watch.tick().catch(() => 0).finally(() => {
      busy = false;
    });
  };
  setTimeout(once, FIRST_TICK_MS).unref?.();
  timer = setInterval(once, TICK_MS);
  timer.unref?.();
}

export function stopScheduleResultWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

import type { CodeStatus } from '../../../shared/code-status';

export type { CodeStatus };

export type ChipTone = 'ok' | 'warn' | 'bad' | 'muted';

export type ChipView = {
  /** Подпись чипа (с планшета и шире; на телефоне — подсказка и aria). */
  label: string;
  tone: ChipTone;
  /** Число на значке телефонного чипа (правки/коммиты). */
  count?: number;
  /** Без числа значок телефонного чипа — «!» (сайт старый/лежит) или галочка (всё дошло). */
  mark?: 'alert' | 'ok';
};

/**
 * Одна строка состояния по приоритету: нет git → чипа нет; несохранённые →
 * не в main → не отправлено → сайт старый/лежит → сайт свежий / всё в main.
 */
export function describeCodeStatus(status: CodeStatus | null): ChipView | null {
  const git = status?.git;
  if (!git) return null;
  if (git.uncommitted > 0) {
    return { label: `Несохранённые правки: ${git.uncommitted}`, tone: 'warn', count: git.uncommitted };
  }
  if (git.mainBranch && git.notInMain > 0) {
    return { label: `Не в ${git.mainBranch}: ${git.notInMain}`, tone: 'warn', count: git.notInMain };
  }
  if (git.unpushed > 0) {
    return { label: `Не отправлено: ${git.unpushed}`, tone: 'warn', count: git.unpushed };
  }
  const site = status?.site;
  if (site?.state === 'stale') {
    return { label: 'На сайте старая версия', tone: 'bad', mark: 'alert' };
  }
  if (site?.state === 'down') {
    return { label: 'Сайт не отвечает', tone: 'bad', mark: 'alert' };
  }
  if (site?.state === 'fresh') {
    return { label: 'На сайте свежая версия', tone: 'ok', mark: 'ok' };
  }
  if (git.mainBranch) {
    return { label: `Всё в ${git.mainBranch}`, tone: 'ok', mark: 'ok' };
  }
  return { label: 'Всё сохранено', tone: 'ok', mark: 'ok' };
}

export function describeSite(site: NonNullable<CodeStatus['site']>): string {
  switch (site.state) {
    case 'fresh':
      return 'свежая версия';
    case 'stale':
      return 'старая версия';
    case 'up':
      return 'отвечает';
    case 'down':
      return 'не отвечает';
    default:
      return 'не узнать';
  }
}

import type { ConfirmActionType, FileStatusCode, GitStatusGroupEntry } from '../types/types';

export const DEFAULT_BRANCH = 'main';
// High enough for the commit graph to show meaningful branch structure.
export const RECENT_COMMITS_LIMIT = 50;

export const FILE_STATUS_GROUPS: GitStatusGroupEntry[] = [
  { key: 'modified', status: 'M' },
  { key: 'added', status: 'A' },
  { key: 'deleted', status: 'D' },
  { key: 'untracked', status: 'U' },
];

export const FILE_STATUS_LABELS: Record<FileStatusCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  U: 'Untracked',
};

// Статус файла — это роль, а не опознавательный цвет: изменён/добавлен/удалён
// красит тема. Текст держим на --foreground: заливка и рамка уже несут цвет,
// а жёлтый/зелёный текст на светлой теме читается плохо.
export const FILE_STATUS_BADGE_CLASSES: Record<FileStatusCode, string> = {
  M: 'bg-warning/20 text-foreground border-warning/40',
  A: 'bg-success/20 text-foreground border-success/40',
  D: 'bg-destructive/20 text-foreground border-destructive/40',
  U: 'bg-muted text-muted-foreground border-border',
};

export const CONFIRMATION_TITLES: Record<ConfirmActionType, string> = {
  discard: 'Discard Changes',
  delete: 'Delete File',
  commit: 'Confirm Action',
  pull: 'Confirm Pull',
  push: 'Confirm Push',
  publish: 'Publish Branch',
  revertLocalCommit: 'Revert Local Commit',
  deleteBranch: 'Delete Branch',
};

export const CONFIRMATION_ACTION_LABELS: Record<ConfirmActionType, string> = {
  discard: 'Discard',
  delete: 'Delete',
  commit: 'Confirm',
  pull: 'Pull',
  push: 'Push',
  publish: 'Publish',
  revertLocalCommit: 'Revert Commit',
  deleteBranch: 'Delete',
};

// Кнопка подтверждения красится по риску действия, а не по фантазии:
// необратимое → destructive, приносящее извне → success, отправка → primary,
// публикация → info, откат → warning.
export const CONFIRMATION_BUTTON_CLASSES: Record<ConfirmActionType, string> = {
// Цвет текста едет вместе с заливкой: белый на светлом success/warning
// не читался, а тема вправе сделать заливку какой угодно светлой.
  discard: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  delete: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  commit: 'bg-primary text-primary-foreground hover:bg-primary/90',
  pull: 'bg-success text-success-foreground hover:bg-success/90',
  push: 'bg-primary text-primary-foreground hover:bg-primary/90',
  publish: 'bg-info text-info-foreground hover:bg-info/90',
  revertLocalCommit: 'bg-warning text-warning-foreground hover:bg-warning/90',
  deleteBranch: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
};

export const CONFIRMATION_ICON_CONTAINER_CLASSES: Record<ConfirmActionType, string> = {
  discard: 'bg-destructive/15',
  delete: 'bg-destructive/15',
  commit: 'bg-warning/15',
  pull: 'bg-warning/15',
  push: 'bg-warning/15',
  publish: 'bg-warning/15',
  revertLocalCommit: 'bg-warning/15',
  deleteBranch: 'bg-destructive/15',
};

export const CONFIRMATION_ICON_CLASSES: Record<ConfirmActionType, string> = {
  discard: 'text-destructive',
  delete: 'text-destructive',
  commit: 'text-warning',
  pull: 'text-warning',
  push: 'text-warning',
  publish: 'text-warning',
  revertLocalCommit: 'text-warning',
  deleteBranch: 'text-destructive',
};

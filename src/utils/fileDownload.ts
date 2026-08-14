import { IS_PLATFORM } from '../constants/config';

// Скачивание файла с сервера.
//
// Осознанно ссылкой, а не через Blob: браузер сам показывает прогресс, ничего
// не держится в памяти вкладки (APK и архивы — десятки мегабайт), и на телефоне
// это работает штатным менеджером загрузок. Токен в адресе — тот же приём, что
// у SSE-эндпоинтов: заголовки к `<a download>` не приделать.

/** Прямой адрес файла, который браузер сохранит на диск. */
export function fileDownloadUrl(projectId: string, filePath: string): string {
  const params = new URLSearchParams({ path: filePath, download: '1' });
  if (!IS_PLATFORM) {
    const token = localStorage.getItem('auth-token');
    if (token) params.set('token', token);
  }
  return `/api/projects/${encodeURIComponent(projectId)}/files/content?${params.toString()}`;
}

/** Скачать файл: тот же путь, что и по ссылке, но без ухода со страницы. */
export function downloadFile(projectId: string, filePath: string, fileName?: string): void {
  const anchor = document.createElement('a');
  anchor.href = fileDownloadUrl(projectId, filePath);
  anchor.download = fileName || filePath.split(/[\\/]/).pop() || 'file';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

const STORAGE_KEY = 'neo3-project-icons';
export const PROJECT_ICON_CHANGED_EVENT = 'neo3:project-icon-changed';

type IconMap = Record<string, string>;

function readMap(): IconMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as IconMap;
  } catch {
    return {};
  }
}

function writeMap(map: IconMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function readProjectIcon(projectId: string): string | null {
  const value = readMap()[projectId];
  return typeof value === 'string' && value.startsWith('data:image/') ? value : null;
}

export function writeProjectIcon(projectId: string, dataUrl: string) {
  const next = { ...readMap(), [projectId]: dataUrl };
  writeMap(next);
  window.dispatchEvent(new CustomEvent(PROJECT_ICON_CHANGED_EVENT, { detail: { projectId } }));
}

export function clearProjectIcon(projectId: string) {
  const next = { ...readMap() };
  delete next[projectId];
  writeMap(next);
  window.dispatchEvent(new CustomEvent(PROJECT_ICON_CHANGED_EVENT, { detail: { projectId } }));
}

export function fileToIconDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('not-image'));
      return;
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('no-canvas'));
        return;
      }
      context.drawImage(image, 0, 0, 256, 256);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('load-failed'));
    };
    image.src = objectUrl;
  });
}

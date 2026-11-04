/**
 * Снимок участка растровой картинки: обрезка в canvas родителя. Картинка —
 * blob-URL того же источника, поэтому canvas не «портится». Сбой — null:
 * просьба уйдёт без снимка.
 */

import { regionToPixels, type FractionRegion, type PixelRect } from './askAgentModel';

/** Longest side of the attached crop. */
const MAX_SIDE = 2048;

export function cropImageRegion(url: string, region: FractionRegion, name: string): Promise<{ file: File | null; pixels: PixelRect | null }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const pixels = regionToPixels(region, { width: image.naturalWidth, height: image.naturalHeight });
      if (!pixels) return resolve({ file: null, pixels: null });
      try {
        const scale = Math.min(1, MAX_SIDE / Math.max(pixels.w, pixels.h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(pixels.w * scale));
        canvas.height = Math.max(1, Math.round(pixels.h * scale));
        const context = canvas.getContext('2d');
        if (!context) return resolve({ file: null, pixels });
        context.drawImage(image, pixels.x, pixels.y, pixels.w, pixels.h, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          resolve({ file: blob && blob.size ? new File([blob], name, { type: 'image/png' }) : null, pixels });
        }, 'image/png');
      } catch {
        resolve({ file: null, pixels });
      }
    };
    image.onerror = () => resolve({ file: null, pixels: null });
    image.src = url;
  });
}

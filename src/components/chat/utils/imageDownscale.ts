/**
 * Shrinks camera-sized photos before they are uploaded.
 *
 * A phone camera shot is ~4000x3000 and several megabytes. Pushing that over a
 * mobile link is exactly where uploads got cut off half-way: the server kept a
 * truncated file, the client's fetch rejected, and the whole message was
 * abandoned. The model never sees more than ~1568px on the long edge anyway,
 * so sending the original buys nothing and costs the upload.
 *
 * Only raster images the canvas can re-encode are touched; anything else
 * (documents, GIF/SVG, already-small pictures) is uploaded untouched, and any
 * failure falls back to the original file rather than blocking the send.
 */

/** Long-edge limit — matches the largest edge Claude's vision path keeps. */
export const MAX_IMAGE_EDGE = 1568;
/** Pictures at or below this size are not worth re-encoding. */
export const DOWNSCALE_MIN_BYTES = 512 * 1024;

/** Formats where re-encoding is safe (animation and vectors are excluded). */
const RE_ENCODABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type DownscaleDecision =
  | { downscale: false }
  | { downscale: true; width: number; height: number; type: string };

/**
 * Pure decision half of the resize, kept separate so it can be unit-tested
 * without a DOM: should this file be re-encoded, and to what dimensions?
 */
export function planDownscale(
  file: { type: string; size: number },
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE,
): DownscaleDecision {
  if (!RE_ENCODABLE.has(file.type)) {
    return { downscale: false };
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge && file.size <= DOWNSCALE_MIN_BYTES) {
    return { downscale: false };
  }
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  return {
    downscale: true,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    // PNG keeps its type (transparency); everything else re-encodes as JPEG.
    type: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
  };
}

/**
 * Returns a smaller copy of `file`, or the original when shrinking is not
 * applicable or not possible in this browser.
 */
export async function downscaleImageFile(file: File): Promise<File> {
  if (!RE_ENCODABLE.has(file.type) || typeof createImageBitmap !== 'function') {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const plan = planDownscale(file, bitmap.width, bitmap.height);
    if (!plan.downscale) {
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, plan.type, 0.85);
    });
    if (!blob || blob.size >= file.size) {
      return file;
    }

    const name = plan.type === 'image/jpeg' ? file.name.replace(/\.(png|webp)$/i, '.jpg') : file.name;
    return new File([blob], name, { type: plan.type, lastModified: file.lastModified });
  } catch (error) {
    console.warn('Image downscale failed, uploading the original:', error);
    return file;
  } finally {
    bitmap?.close();
  }
}

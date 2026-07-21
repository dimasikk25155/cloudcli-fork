import { useEffect, useState } from 'react';
import { Download, FileIcon } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import type { ChatImage } from '../../types/types';
import ImageLightbox from './ImageLightbox';

/** Whether an attachment entry is a viewable image vs a generic file chip. */
function isImageEntry(image: ChatImage): boolean {
  if (image.data) return true;
  if (image.mimeType) return image.mimeType.startsWith('image/');
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(image.name || image.path || '');
}

type ChatMessageImagesProps = {
  images: ChatImage[];
  projectId?: string | null;
};

/**
 * Resolves one chat image to a displayable src. Inline data URLs are used
 * directly; path-based attachments are fetched as blobs (a bare <img src>
 * cannot carry the auth header) — first from the global assets route
 * (`~/.cloudcli/assets`), then from the project files route as a fallback for
 * sessions recorded before attachments moved to the global store.
 */
function useChatImageSrc(image: ChatImage, projectId?: string | null): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(image.data || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image.data) {
      setSrc(image.data);
      setFailed(false);
      return;
    }

    const imagePath = image.path;
    if (!imagePath) {
      setSrc(null);
      setFailed(true);
      return;
    }

    const filename = imagePath.split(/[\\/]/).pop() || '';
    const candidateUrls = [
      `/api/assets/images/${encodeURIComponent(filename)}`,
      ...(projectId
        ? [`/api/projects/${projectId}/files/content?path=${encodeURIComponent(imagePath)}`]
        : []),
    ];

    let objectUrl: string | null = null;
    const controller = new AbortController();

    const load = async () => {
      setFailed(false);
      for (const url of candidateUrls) {
        try {
          const response = await authenticatedFetch(url, { signal: controller.signal });
          if (!response.ok) {
            continue;
          }
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
        }
      }
      setSrc(null);
      setFailed(true);
    };

    void load();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image.data, image.path, projectId]);

  return { src, failed };
}

function ChatMessageImage({ image, projectId }: { image: ChatImage; projectId?: string | null }) {
  const { src, failed } = useChatImageSrc(image, projectId);
  const [expanded, setExpanded] = useState(false);
  const alt = image.name || 'Attached image';

  if (failed) {
    return (
      <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-border/50 bg-muted px-2 text-center text-[10px] text-muted-foreground">
        {alt}
      </div>
    );
  }

  if (!src) {
    return <div className="h-28 w-28 animate-pulse rounded-xl border border-border/50 bg-muted" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Expand ${alt}`}
        className="block overflow-hidden rounded-xl border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
      >
        <img
          src={src}
          alt={alt}
          className="h-28 w-28 cursor-zoom-in object-cover transition-transform duration-200 hover:scale-105"
        />
      </button>
      {expanded && <ImageLightbox src={src} alt={alt} onClose={() => setExpanded(false)} />}
    </>
  );
}

/** Compact download chip for a non-image file attachment on a user turn. */
function ChatMessageFile({ file }: { file: ChatImage }) {
  const [downloading, setDownloading] = useState(false);
  const name = file.name || file.path?.split(/[\\/]/).pop() || 'file';

  const handleDownload = async () => {
    if (!file.path || downloading) return;
    const filename = file.path.split(/[\\/]/).pop() || '';
    setDownloading(true);
    try {
      const response = await authenticatedFetch(`/api/assets/images/${encodeURIComponent(filename)}`);
      if (!response.ok) return;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // A failed download just leaves the chip untouched — no user-facing error.
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={!file.path || downloading}
      title={name}
      className="flex max-w-64 items-center gap-2 rounded-xl border border-border/50 bg-muted/40 px-3 py-2 text-left shadow-sm transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-muted/40"
    >
      <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="truncate text-xs font-medium text-foreground">{name}</span>
      {file.path && <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/**
 * Attachments for a user turn, rendered claude.ai-style above the message
 * bubble: images as thumbnail cards (expand to a lightbox), other files as
 * compact download chips.
 */
export default function ChatMessageImages({ images, projectId }: ChatMessageImagesProps) {
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {images.map((image, index) =>
        isImageEntry(image) ? (
          <ChatMessageImage key={image.path || image.name || index} image={image} projectId={projectId} />
        ) : (
          <ChatMessageFile key={image.path || image.name || index} file={image} />
        ),
      )}
    </div>
  );
}

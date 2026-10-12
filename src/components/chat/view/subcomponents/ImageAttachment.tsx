import { useEffect, useState } from 'react';
import { FileIcon, Pencil } from 'lucide-react';

import { isPictureFile } from '../../utils/screenshotCaption';
import ImageLightbox from './ImageLightbox';
import ImageMarkupEditor from './ImageMarkupEditor';

interface ImageAttachmentProps {
  file: File;
  onRemove: () => void;
  uploadProgress?: number;
  error?: string;
  /** Swap the attachment for its marked-up copy; enables the «✎» button. */
  onReplace?: (file: File) => void;
}

/** Human-readable byte size, e.g. "3.2 MB". */
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * Composer attachment card. Images show a thumbnail preview that expands to a
 * lightbox on click; every other file type shows a compact card with a file
 * icon, its name, and size — since there is nothing to preview. Both carry
 * the upload-progress / error overlays and a remove button.
 */
const ImageAttachment = ({ file, onRemove, uploadProgress, error, onReplace }: ImageAttachmentProps) => {
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const isImage = isPictureFile(file);
  const canMarkUp = Boolean(onReplace) && isImage && uploadProgress === undefined;

  useEffect(() => {
    if (!isImage) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="group relative">
      {isImage ? (
        <button
          type="button"
          onClick={() => preview && setExpanded(true)}
          aria-label={`Expand ${file.name}`}
          className="block overflow-hidden rounded-xl border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
        >
          <img
            src={preview}
            alt={file.name}
            className="h-20 w-20 cursor-zoom-in object-cover transition-transform duration-200 hover:scale-105"
          />
        </button>
      ) : (
        <div className="flex h-20 w-40 items-center gap-2 overflow-hidden rounded-xl border border-border/50 bg-muted/40 px-3 shadow-sm">
          <FileIcon className="h-6 w-6 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground" title={file.name}>
              {file.name}
            </div>
            <div className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</div>
          </div>
        </div>
      )}
      {uploadProgress !== undefined && uploadProgress < 100 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
          <div className="text-xs text-white">{uploadProgress}%</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-red-500/50">
          <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 rounded-full border border-border/40 bg-background/90 p-1 text-foreground shadow-sm backdrop-blur transition-opacity hover:bg-background focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Remove attachment"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {canMarkUp && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="absolute -bottom-1.5 -left-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-background/95 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/60"
          aria-label={`Пометки на ${file.name}`}
          title="Обвести, стрелка, текст"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {editing && onReplace && (
        <ImageMarkupEditor
          file={file}
          onCancel={() => setEditing(false)}
          onSave={(marked) => {
            setEditing(false);
            onReplace(marked);
          }}
        />
      )}
      {expanded && preview && (
        <ImageLightbox src={preview} alt={file.name} onClose={() => setExpanded(false)} />
      )}
    </div>
  );
};

export default ImageAttachment;

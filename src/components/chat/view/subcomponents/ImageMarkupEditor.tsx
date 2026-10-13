import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Circle, Pencil, Type, Undo2, X } from 'lucide-react';

import {
  ENCODABLE_TYPES,
  commitShape,
  markedFileIdentity,
  markupCanvasSize,
  markupScale,
  renderMarkup,
  undoShape,
  type MarkupHistory,
  type MarkupShape,
  type MarkupTool,
  type Point,
} from '../../utils/imageMarkup';

type ImageMarkupEditorProps = {
  file: File;
  /** The marked-up picture, same name and type where the browser can encode it. */
  onSave: (file: File) => void;
  onCancel: () => void;
};

const COLORS: { value: string; label: string }[] = [
  { value: '#ef4444', label: 'Красный' },
  { value: '#facc15', label: 'Жёлтый' },
  { value: '#22c55e', label: 'Зелёный' },
  { value: '#3b82f6', label: 'Синий' },
  { value: '#ffffff', label: 'Белый' },
  { value: '#000000', label: 'Чёрный' },
];

const TOOLS: { id: MarkupTool; label: string; Icon: typeof Pencil }[] = [
  { id: 'pen', label: 'Карандаш', Icon: Pencil },
  { id: 'ellipse', label: 'Овал', Icon: Circle },
  { id: 'arrow', label: 'Стрелка', Icon: ArrowUpRight },
  { id: 'text', label: 'Текст', Icon: Type },
];

const JPEG_QUALITY = 0.92;

/**
 * Full-screen markup editor for an attached picture: pencil, oval, arrow,
 * text, colour (red by default), undo, save, close. Pointer events cover
 * mouse, pen and finger alike; `touch-action: none` on the canvas keeps a
 * finger stroke from scrolling or zooming the page.
 */
export default function ImageMarkupEditor({ file, onSave, onCancel }: ImageMarkupEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const historyRef = useRef<MarkupHistory>([]);
  const draftRef = useRef<MarkupShape | null>(null);
  const frameRef = useRef<number | null>(null);

  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tool, setTool] = useState<MarkupTool>('pen');
  const [color, setColor] = useState(COLORS[0].value);
  const [history, setHistory] = useState<MarkupHistory>([]);
  const [pendingText, setPendingText] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setSize(markupCanvasSize(image.naturalWidth, image.naturalHeight));
    };
    image.onerror = () => setLoadError(true);
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !image || !context) {
      return;
    }
    renderMarkup(context, image, canvas.width, canvas.height, historyRef.current, draftRef.current);
  }, []);

  const schedulePaint = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      paint();
    });
  }, [paint]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
  }, []);

  useEffect(() => {
    historyRef.current = history;
    paint();
  }, [history, size, paint]);

  const applyHistory = useCallback((next: MarkupHistory) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const scale = size ? markupScale(size.width, size.height) : { lineWidth: 6, fontSize: 40 };

  const toImagePoint = (event: { clientX: number; clientY: number }): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!event.isPrimary || saving || pendingText) {
      return;
    }
    const point = toImagePoint(event);
    if (!point) {
      return;
    }
    event.preventDefault();
    if (tool === 'text') {
      setTextValue('');
      setPendingText(point);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draftRef.current = tool === 'pen'
      ? { kind: 'pen', color, width: scale.lineWidth, points: [point] }
      : { kind: tool, color, width: scale.lineWidth, from: point, to: point };
    schedulePaint();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current;
    if (!draft || !event.isPrimary) {
      return;
    }
    if (draft.kind === 'pen') {
      // Coalesced events keep a fast finger stroke smooth instead of polygonal.
      const native = event.nativeEvent;
      const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
      for (const sample of samples.length > 0 ? samples : [native]) {
        const point = toImagePoint(sample);
        if (point) {
          draft.points.push(point);
        }
      }
    } else if (draft.kind === 'ellipse' || draft.kind === 'arrow') {
      const point = toImagePoint(event);
      if (point) {
        draft.to = point;
      }
    }
    schedulePaint();
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>, keep: boolean) => {
    const draft = draftRef.current;
    if (!draft || !event.isPrimary) {
      return;
    }
    draftRef.current = null;
    if (keep) {
      applyHistory(commitShape(historyRef.current, draft));
    }
    paint();
  };

  const confirmText = () => {
    if (pendingText) {
      applyHistory(commitShape(historyRef.current, {
        kind: 'text',
        color,
        size: scale.fontSize,
        at: pendingText,
        text: textValue,
      }));
    }
    setPendingText(null);
    setTextValue('');
  };

  const handleUndo = () => applyHistory(undoShape(historyRef.current));

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || saving || historyRef.current.length === 0) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    draftRef.current = null;
    paint();
    const requestedType = ENCODABLE_TYPES.has(file.type) ? file.type : 'image/png';
    const fail = () => {
      setSaving(false);
      setSaveError('Не получилось сохранить пометки. Попробуй ещё раз или закрой и отправь картинку без них.');
    };
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            fail();
            return;
          }
          const identity = markedFileIdentity(file.name, file.type, blob.type);
          onSave(new File([blob], identity.name, { type: identity.type, lastModified: Date.now() }));
        },
        requestedType,
        requestedType === 'image/jpeg' ? JPEG_QUALITY : undefined,
      );
    } catch (error) {
      console.error('Markup save failed:', error);
      fail();
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.stopPropagation();
      if (pendingText) {
        setPendingText(null);
      } else {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancel, pendingText]);

  const canSave = history.length > 0 && !saving;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex select-none flex-col overscroll-contain bg-neutral-950 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Пометки на картинке"
      data-testid="image-markup-editor"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-11 items-center gap-1.5 rounded-full px-3 text-sm text-white/85 hover:bg-white/10"
          aria-label="Закрыть без сохранения"
        >
          <X className="h-5 w-5" />
          Закрыть
        </button>
        <span className="truncate text-sm text-white/60">Пометки</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="h-11 rounded-full bg-white px-5 text-sm font-semibold text-neutral-950 transition-opacity disabled:opacity-40"
        >
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex items-center justify-center p-2">
          {loadError ? (
            <p className="px-6 text-center text-sm text-white/70">
              Не получилось открыть картинку в редакторе. Её можно отправить как есть.
            </p>
          ) : (
            <canvas
              ref={canvasRef}
              width={size?.width ?? 1}
              height={size?.height ?? 1}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => finishStroke(event, true)}
              onPointerCancel={(event) => finishStroke(event, false)}
              className={`max-h-full max-w-full rounded-md shadow-2xl ${tool === 'text' ? 'cursor-text' : 'cursor-crosshair'} ${size ? '' : 'invisible'}`}
              style={{ touchAction: 'none' }}
              aria-label={`Картинка ${file.name}`}
            />
          )}
        </div>

        {saveError && (
          <div role="alert" className="absolute inset-x-2 bottom-2 rounded-lg bg-red-600/95 px-3 py-2 text-sm text-white shadow-lg">
            {saveError}
          </div>
        )}

        {pendingText && (
          <div className="absolute inset-x-0 top-0 flex gap-2 bg-neutral-900/95 p-2 shadow-lg">
            <input
              autoFocus
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  confirmText();
                }
              }}
              placeholder="Подпись на картинке"
              className="h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-neutral-800 px-3 text-base text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/40"
              aria-label="Текст подписи"
            />
            <button
              type="button"
              onClick={() => setPendingText(null)}
              className="h-11 rounded-lg px-3 text-sm text-white/75 hover:bg-white/10"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={confirmText}
              disabled={!textValue.trim()}
              className="h-11 rounded-lg bg-white px-4 text-sm font-semibold text-neutral-950 disabled:opacity-40"
            >
              Готово
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-white/10 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex items-stretch justify-between gap-1">
          {TOOLS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTool(id)}
              aria-pressed={tool === id}
              className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] transition-colors ${
                tool === id ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10'
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] text-white/65 transition-colors hover:bg-white/10 disabled:opacity-35"
          >
            <Undo2 className="h-5 w-5" />
            Отменить
          </button>
        </div>
        <div className="flex items-center justify-center gap-3" role="radiogroup" aria-label="Цвет">
          {COLORS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={color === value}
              aria-label={label}
              onClick={() => setColor(value)}
              className={`h-9 w-9 rounded-full border-2 transition-transform ${
                color === value ? 'scale-110 border-white' : 'border-white/25'
              }`}
              style={{ backgroundColor: value }}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Рейка кадров-слайдов слева от холста правки (слот `leftRail`). Кадры —
 * первый набор ≥2 из `[data-slide]`, `.slide`, `section` (`findFrames`).
 * Миниатюра — уменьшенный снимок того же превью (мост `snapshot`).
 * Клик — к кадру и выделить его; перетаскивание (или Alt+↑/↓) — операция
 * `frameOrder` в общей истории правки: отменяется и сохраняется как остальные.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useArtifactEditor } from './editorContext';
import { frameDropOrder } from './frames';

const THUMB_WIDTH = 176;
/** Edits come in bursts: thumbnails are redrawn once they settle. */
const REDRAW_DELAY_MS = 700;

/** A big PNG data URL → a small one for the rail; the original if shrinking fails. */
function shrink(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, THUMB_WIDTH * 2 / Math.max(1, image.naturalWidth));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return resolve(dataUrl);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

export default function SlidesRail() {
  const editor = useArtifactEditor();
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropBefore, setDropBefore] = useState<number | null>(null);
  const snapshotRef = useRef(editor?.snapshot);
  snapshotRef.current = editor?.snapshot;

  const frames = editor?.frames ?? [];
  const framesKey = frames.join(',');
  const ready = Boolean(editor?.ready);
  const revision = editor?.revision ?? 0;

  useEffect(() => {
    if (!ready || frames.length < 2) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      for (const id of frames) {
        if (cancelled) return;
        const url = await snapshotRef.current?.(id);
        const small = url ? await shrink(url) : null;
        if (cancelled) return;
        setThumbs((current) => ({ ...current, [id]: small }));
      }
    }, REDRAW_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `framesKey` stands for `frames`; `revision` — the document changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framesKey, ready, revision]);

  if (!editor || frames.length < 2) return null;

  const move = (from: number, before: number) => {
    const next = frameDropOrder(frames, from, before);
    if (next) editor.apply([{ type: 'frameOrder', ids: next }]);
  };

  const open = (id: string) => {
    editor.select([id]);
    editor.scrollTo(id);
  };

  const endDrag = () => {
    setDragFrom(null);
    setDropBefore(null);
  };

  return (
    <nav aria-label="Слайды" className="flex w-44 flex-shrink-0 flex-col border-r border-border/70 bg-card/40" data-editor-slides>
      <p className="flex-shrink-0 px-2.5 pb-1 pt-2 text-[11px] text-muted-foreground">
        Слайды: {frames.length}. Перетащи, чтобы поменять порядок
      </p>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
        {frames.map((id, index) => {
          const selected = editor.selection.includes(id);
          const thumb = thumbs[id];
          return (
            <li key={id} className="relative">
              {dragFrom !== null && dropBefore === index && <span className="absolute -top-1.5 left-0 right-0 h-0.5 rounded bg-primary" aria-hidden />}
              <button
                type="button"
                draggable
                onClick={() => open(id)}
                onKeyDown={(event) => {
                  if (!event.altKey) return;
                  if (event.key === 'ArrowUp' && index > 0) {
                    event.preventDefault();
                    move(index, index - 1);
                  } else if (event.key === 'ArrowDown' && index < frames.length - 1) {
                    event.preventDefault();
                    move(index, index + 2);
                  }
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', id);
                  setDragFrom(index);
                }}
                onDragOver={(event) => {
                  if (dragFrom === null) return;
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  setDropBefore(event.clientY < box.top + box.height / 2 ? index : index + 1);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragFrom !== null && dropBefore !== null) move(dragFrom, dropBefore);
                  endDrag();
                }}
                onDragEnd={endDrag}
                aria-current={selected ? 'true' : undefined}
                aria-label={`Слайд ${index + 1}. Alt+стрелки — переставить`}
                className={`group block w-full rounded-lg border-2 p-1 text-left transition-colors ${selected ? 'border-primary' : 'border-transparent hover:border-border'} ${dragFrom === index ? 'opacity-40' : ''}`}
              >
                <span className="relative block overflow-hidden rounded bg-white ring-1 ring-border/60">
                  {thumb ? (
                    <img src={thumb} alt="" className="block h-auto w-full" draggable={false} />
                  ) : (
                    <span className="flex aspect-video items-center justify-center text-muted-foreground">
                      {thumb === null ? <span className="text-[10px]">без миниатюры</span> : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
              </button>
              {dragFrom !== null && index === frames.length - 1 && dropBefore === frames.length && (
                <span className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded bg-primary" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

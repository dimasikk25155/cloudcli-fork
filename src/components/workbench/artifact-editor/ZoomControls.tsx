/**
 * Масштаб холста правки: −, процент (клик — 100 %), +, «Вписать».
 * Cmd/Ctrl+колесо обрабатывает сам редактор. Живёт в `toolbarExtras`.
 */

import React from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

import { useArtifactEditor } from './editorContext';
import { ZOOM_MAX, ZOOM_MIN, fitZoom, stepZoom, zoomLabel } from './zoomModel';

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';

export default function ZoomControls() {
  const editor = useArtifactEditor();
  if (!editor) return null;
  const { zoom, setZoom, contentSize, stageSize, kind } = editor;

  const fit = () => {
    if (!contentSize) return;
    setZoom(fitZoom({
      kind,
      contentWidth: contentSize.width,
      contentHeight: contentSize.height,
      viewportWidth: contentSize.viewportWidth,
      stageWidth: stageSize.width,
      stageHeight: stageSize.height,
    }));
  };

  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label="Масштаб" data-editor-zoom>
      <button type="button" className={btn} onClick={() => setZoom(stepZoom(zoom, -1))} disabled={zoom <= ZOOM_MIN} title="Уменьшить (⌘ + колесо)" aria-label="Уменьшить">
        <ZoomOut className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button type="button" className={`${btn} min-w-[4.25rem] justify-center tabular-nums`} onClick={() => setZoom(1)} title="Сбросить до 100 %" aria-label={`Масштаб ${zoomLabel(zoom)}, сбросить до 100 %`}>
        {zoomLabel(zoom)}
      </button>
      <button type="button" className={btn} onClick={() => setZoom(stepZoom(zoom, 1))} disabled={zoom >= ZOOM_MAX} title="Увеличить (⌘ + колесо)" aria-label="Увеличить">
        <ZoomIn className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button type="button" className={btn} onClick={fit} disabled={!contentSize} title="Показать страницу целиком по ширине">
        <Maximize2 className="h-3.5 w-3.5" aria-hidden />Вписать
      </button>
    </span>
  );
}

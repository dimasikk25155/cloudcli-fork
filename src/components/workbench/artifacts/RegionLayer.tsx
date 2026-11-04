import React, { useRef, useState } from 'react';

import { rectFromDrag, type FractionRect } from './artifactModel';

export type RegionMarker = { id: string; label: string; rect: FractionRect; muted: boolean };

const style = (rect: FractionRect): React.CSSProperties => ({
  left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
});

/**
 * Layer over a preview frame: draws the comment regions and, while `active`,
 * catches a drag and reports the region in fractions of the frame.
 */
export default function RegionLayer({ active, markers, draft, onRegion }: {
  active: boolean;
  markers: RegionMarker[];
  draft: FractionRect | null;
  onRegion: (rect: FractionRect) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<FractionRect | null>(null);

  const point = (event: React.PointerEvent) => {
    const box = layerRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, box };
  };

  return (
    <div
      ref={layerRef}
      className={`absolute inset-0 z-10 ${active ? 'cursor-crosshair bg-primary/5' : 'pointer-events-none'}`}
      onPointerDown={active ? (event) => {
        event.preventDefault();
        (event.target as Element).setPointerCapture?.(event.pointerId);
        const { x, y } = point(event);
        setStart({ x, y });
        setCurrent(null);
      } : undefined}
      onPointerMove={active && start ? (event) => {
        const { x, y, box } = point(event);
        setCurrent(rectFromDrag(start, { x, y }, box));
      } : undefined}
      onPointerUp={active && start ? (event) => {
        const { x, y, box } = point(event);
        const rect = rectFromDrag(start, { x, y }, box);
        setStart(null);
        setCurrent(null);
        if (rect) onRegion(rect);
      } : undefined}
      data-artifact-region-layer
    >
      {markers.map((marker) => (
        <div
          key={marker.id}
          className={`pointer-events-none absolute rounded border-2 ${marker.muted ? 'border-muted-foreground/40' : 'border-primary bg-primary/10'}`}
          style={style(marker.rect)}
        >
          <span className={`absolute -left-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold text-white ${marker.muted ? 'bg-muted-foreground/60' : 'bg-primary'}`}>
            {marker.label}
          </span>
        </div>
      ))}
      {(current ?? draft) && (
        <div className="pointer-events-none absolute rounded border-2 border-dashed border-primary bg-primary/15" style={style((current ?? draft)!)} />
      )}
    </div>
  );
}

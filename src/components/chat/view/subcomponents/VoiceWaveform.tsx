import { useEffect, useRef, useState } from 'react';

// The bar strip scrolls right-to-left one step per SHIFT_MS. At 60 Hz the wave
// would blur into noise; ~18 steps a second reads as speech.
const SHIFT_MS = 55;
const FLOOR = 0.08; // silence keeps a thin line, so the mic still looks alive
const BARS_WIDE = 26;
const BARS_NARROW = 15; // phones: the composer has no room for the full strip
const FADE_LEFT = 'linear-gradient(to right, transparent, #000 24%)';

const formatElapsed = (ms: number) => {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

type Props = {
  /** Current mic loudness, 0..1. */
  getLevel: () => number;
  /** Milliseconds since recording started. */
  getElapsedMs: () => number;
};

/**
 * Live mic level + elapsed time, shown next to the mic button while recording.
 * Mounted only during a recording, and animated entirely through refs: bar
 * heights and the clock are written straight to the DOM so a moving waveform
 * never re-renders the composer.
 */
export default function VoiceWaveform({ getLevel, getElapsedMs }: Props) {
  const barsRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [barCount] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 480 ? BARS_NARROW : BARS_WIDE,
  );

  useEffect(() => {
    const bars = Array.from(barsRef.current?.children ?? []) as HTMLElement[];
    const levels: number[] = new Array(bars.length).fill(FLOOR);
    let raf = 0;
    let lastShift = 0;
    let lastSecond = -1;
    let peak = FLOOR;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // Sample every frame but paint on the slower beat: a short loud syllable
      // between two shifts must not be averaged away.
      peak = Math.max(peak, getLevel());
      if (now - lastShift < SHIFT_MS) return;
      lastShift = now;
      levels.push(peak);
      levels.shift();
      peak = FLOOR;
      for (let i = 0; i < bars.length; i += 1) {
        bars[i].style.transform = `scaleY(${Math.max(FLOOR, levels[i])})`;
      }
      const seconds = Math.floor(getElapsedMs() / 1000);
      if (seconds !== lastSecond && timeRef.current) {
        lastSecond = seconds;
        timeRef.current.textContent = formatElapsed(seconds * 1000);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [getLevel, getElapsedMs]);

  return (
    <span className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 py-1 pl-2 pr-2.5 shadow-sm">
      {/* One red accent — the rec dot. Painting the whole strip red looks cheap. */}
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
      </span>
      <span
        ref={barsRef}
        aria-hidden
        className="flex h-4 items-center gap-[2px]"
        // Old samples dissolve on the left instead of ending in a hard edge.
        style={{ maskImage: FADE_LEFT, WebkitMaskImage: FADE_LEFT }}
      >
        {Array.from({ length: barCount }, (_, i) => (
          <span
            key={i}
            className="h-4 w-[2px] rounded-full bg-foreground/70"
            style={{ transform: `scaleY(${FLOOR})`, transition: `transform ${SHIFT_MS}ms linear` }}
          />
        ))}
      </span>
      <span
        ref={timeRef}
        role="timer"
        className="min-w-[2.6ch] text-[11px] font-medium tabular-nums text-muted-foreground"
      >
        0:00
      </span>
    </span>
  );
}

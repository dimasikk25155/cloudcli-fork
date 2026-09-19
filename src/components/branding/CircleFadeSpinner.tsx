/**
 * SpinKit Circle Fade — 12 dots on a ring, fading around the circle.
 * Port of https://tobiasahlin.com/spinkit/ (MIT). Color follows `currentColor`.
 */
import type { CSSProperties } from 'react';

import { cn } from '../../lib/utils';

const DOT_COUNT = 12;

type CircleFadeSpinnerProps = {
  className?: string;
  size?: number;
};

function delayFor(index: number): string {
  return index === 0 ? '0s' : `${(-1.2 + index * 0.1).toFixed(1)}s`;
}

export default function CircleFadeSpinner({ className, size = 48 }: CircleFadeSpinnerProps) {
  return (
    <span
      className={cn('relative inline-block text-foreground', className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <style>{`
        @keyframes neo3-circle-fade {
          0%, 39%, 100% { opacity: 0; }
          40% { opacity: 1; }
        }
        .neo3-circle-fade-dot::before {
          content: '';
          display: block;
          margin: 0 auto;
          width: 15%;
          height: 15%;
          border-radius: 100%;
          background: currentColor;
          animation: neo3-circle-fade 1.2s infinite ease-in-out both;
          animation-delay: var(--neo3-circle-fade-delay);
        }
        @media (prefers-reduced-motion: reduce) {
          .neo3-circle-fade-dot::before {
            animation: none;
            opacity: 0.45;
          }
        }
      `}</style>
      {Array.from({ length: DOT_COUNT }, (_, i) => (
        <span
          key={i}
          className="neo3-circle-fade-dot absolute inset-0"
          style={
            {
              transform: `rotate(${i * 30}deg)`,
              '--neo3-circle-fade-delay': delayFor(i),
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

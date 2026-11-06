/**
 * Знак Neo3 для плитки самого проекта: крупная «N» и надстрочная «3».
 * Рисуется цветом `currentColor` (его задаёт AppIcon), не lucide-смайлик.
 */
import React from 'react';

type Neo3MarkProps = {
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
};

export default function Neo3Mark({ className, style }: Neo3MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true" focusable="false" data-neo3-mark="">
      <path
        d="M3 20V5.6c0-.7.5-1.2 1.2-1.2h2c.4 0 .8.2 1 .6l5.8 8.9V4.4h3.6v14.4c0 .7-.5 1.2-1.2 1.2h-2c-.4 0-.8-.2-1-.6L6.6 10.5V20Z"
        fill="currentColor"
      />
      <path
        d="M18.3 2.6h3.4l-2 2.3a2 2 0 1 1-1.7 3.1"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.75}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

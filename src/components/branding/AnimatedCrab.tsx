/**
 * Claude CLI mascot — a friendly terracotta crab.
 *
 * Inline SVG so it inherits sizing from `className` and needs no asset
 * request. Animations (gentle bob, claw waves, blinking) are scoped to
 * this SVG via class names and disabled for users who prefer reduced
 * motion. Pass `animated={false}` for a static render.
 */
type AnimatedCrabProps = {
  className?: string;
  animated?: boolean;
};

export default function AnimatedCrab({ className, animated = true }: AnimatedCrabProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" role="img" aria-label="Claude CLI">
      {animated && (
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .crab-bob { animation: crab-bob 3.2s ease-in-out infinite; }
            .crab-claw-l { animation: crab-wave-l 3.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 90% 90%; }
            .crab-claw-r { animation: crab-wave-r 3.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 10% 90%; }
            .crab-eyes { animation: crab-blink 4.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
          }
          @keyframes crab-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1.6px); } }
          @keyframes crab-wave-l { 0%, 100% { transform: rotate(0deg); } 30% { transform: rotate(-13deg); } 60% { transform: rotate(4deg); } }
          @keyframes crab-wave-r { 0%, 100% { transform: rotate(0deg); } 40% { transform: rotate(13deg); } 70% { transform: rotate(-4deg); } }
          @keyframes crab-blink { 0%, 91%, 97%, 100% { transform: scaleY(1); } 94% { transform: scaleY(0.1); } }
        `}</style>
      )}
      <g className="crab-bob">
        {/* legs */}
        <path d="M20 50 Q15 53 11 54" stroke="#C96442" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M23 53 Q20 57 17 59" stroke="#C96442" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M44 50 Q49 53 53 54" stroke="#C96442" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M41 53 Q44 57 47 59" stroke="#C96442" strokeWidth="2.6" strokeLinecap="round" />

        {/* arms */}
        <path d="M19 36 Q11 33 9 27" stroke="#C96442" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M45 36 Q53 33 55 27" stroke="#C96442" strokeWidth="3.2" strokeLinecap="round" />

        {/* claws (pac-man pincers) */}
        <g className="crab-claw-l">
          <path d="M9.5 21.5 L15 17.6 A6.8 6.8 0 1 0 15 25.4 Z" fill="#D97757" />
        </g>
        <g className="crab-claw-r">
          <path d="M54.5 21.5 L49 17.6 A6.8 6.8 0 1 1 49 25.4 Z" fill="#D97757" />
        </g>

        {/* eye stalks */}
        <path d="M26.5 31 Q25.5 26 25 22.5" stroke="#C96442" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M37.5 31 Q38.5 26 39 22.5" stroke="#C96442" strokeWidth="2.2" strokeLinecap="round" />

        {/* body */}
        <ellipse cx="32" cy="40" rx="15.5" ry="11.5" fill="#D97757" />
        <ellipse cx="32" cy="43.5" rx="10.5" ry="6.5" fill="#E08963" opacity="0.55" />

        {/* eyes */}
        <g className="crab-eyes">
          <circle cx="25" cy="20.5" r="4.4" fill="#FFFCF5" />
          <circle cx="39" cy="20.5" r="4.4" fill="#FFFCF5" />
          <circle cx="25.6" cy="21" r="2" fill="#3D3929" />
          <circle cx="39.6" cy="21" r="2" fill="#3D3929" />
          <circle cx="24.6" cy="19.6" r="0.8" fill="#FFFFFF" />
          <circle cx="38.6" cy="19.6" r="0.8" fill="#FFFFFF" />
        </g>

        {/* face */}
        <path d="M27.5 41.5 Q32 45.5 36.5 41.5" stroke="#3D3929" strokeWidth="2" strokeLinecap="round" fill="none" />
        <circle cx="22.5" cy="41" r="1.9" fill="#F0A583" opacity="0.8" />
        <circle cx="41.5" cy="41" r="1.9" fill="#F0A583" opacity="0.8" />
      </g>
    </svg>
  );
}

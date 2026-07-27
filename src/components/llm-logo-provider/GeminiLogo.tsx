type GeminiLogoProps = {
  className?: string;
};

/**
 * Google Gemini mark — the four-point spark, drawn as a single path so it
 * inherits the surrounding text color like the other provider logos.
 */
export default function GeminiLogo({ className = 'w-5 h-5' }: GeminiLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M12 2c.36 3.02 1.3 5.28 2.83 6.8C16.36 10.32 18.7 11.3 21.8 11.7v.6c-3.1.4-5.44 1.38-6.97 2.9C13.3 16.72 12.36 18.98 12 22c-.36-3.02-1.3-5.28-2.83-6.8C7.64 13.68 5.3 12.7 2.2 12.3v-.6c3.1-.4 5.44-1.38 6.97-2.9C10.7 7.28 11.64 5.02 12 2z" />
    </svg>
  );
}

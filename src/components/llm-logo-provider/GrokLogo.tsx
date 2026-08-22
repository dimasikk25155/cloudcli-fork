type GrokLogoProps = {
  className?: string;
};

/**
 * xAI / Grok monogram. Uses currentColor so it inherits the surrounding text
 * colour and stays legible in every theme, same as the Gemini mark.
 */
export function GrokLogo({ className = 'w-5 h-5' }: GrokLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default GrokLogo;

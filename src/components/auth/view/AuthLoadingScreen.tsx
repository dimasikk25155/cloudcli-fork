import { APP_NAME, CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../constants/branding';
import CircleFadeSpinner from '../../branding/CircleFadeSpinner';

export default function AuthLoadingScreen() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="relative text-center" role="status" aria-live="polite">
        <div className="mb-5 flex justify-center">
          <CircleFadeSpinner size={48} />
        </div>

        <h1
          className="text-2xl font-bold tracking-tight text-foreground"
          style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
        >
          {APP_NAME}
        </h1>
        <p className="sr-only">Loading authentication state…</p>
      </div>
    </div>
  );
}

import ShaderBackground from './ShaderBackground';
import AetherShaderBackground from './AetherShaderBackground';

/**
 * Per-theme full-viewport background, rendered behind the whole app at z-0.
 *
 * Each theme owns its own backdrop so themes look genuinely different, not
 * just recoloured. Cinematic themes use a real generated 4K photograph
 * (public/theme-bg/<key>.jpg) with a subtle Ken Burns drift and a dark scrim
 * for text legibility, rather than hand-drawn CSS shapes — attempts at
 * replicating scenes like a command bridge or a nebula in pure CSS read as
 * cheap; a real photographic still does not.
 */
const PHOTO_THEMES = new Set([
  'commandDeck',
  'neonCity',
  'synthwaveDrive',
  'nebulaFlow',
  'missionControl',
  'bento3d',
  'kineticType',
  'liquidChrome',
  'zenParticles',
]);

export default function ThemeBackground({ theme = 'default' }: { theme?: string }) {
  if (theme === 'aether') {
    return <AetherShaderBackground />;
  }

  if (theme === 'liquidGlass') {
    return (
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {/* Graded pastel base */}
        <div className="lg-bg" />
        {/* Soft drifting light — slow, GPU-composited */}
        <div className="lg-aurora lg-aurora--violet" />
        <div className="lg-aurora lg-aurora--cyan" />
        <div className="lg-aurora lg-aurora--magenta" />
        <div className="lg-aurora lg-aurora--emerald" />
        {/* Sheen + vignette so frosted panels read as glass */}
        <div className="lg-veil" />
      </div>
    );
  }

  if (PHOTO_THEMES.has(theme)) {
    return (
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="theme-photo-bg"
          style={{ backgroundImage: `url(/theme-bg/${theme}.jpg)` }}
        />
        <div className="theme-photo-scrim" />
      </div>
    );
  }

  // Default theme: original animated WebGL background.
  return <ShaderBackground variant="default" />;
}

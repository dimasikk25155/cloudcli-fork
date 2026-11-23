import React from 'react';
import { useTranslation } from 'react-i18next';

import NeonTile from '../app-icon/neon/NeonTile';
import { useMobileMenuHandlers } from '../main-content/hooks/useMobileMenuHandlers';

type HomeClockRowProps = {
  time: string;
  /** Phone only: the ☰ that opens the side menu (desktop has the sidebar). */
  onMenuClick?: () => void;
  onShowSettings: () => void;
};

const ACCENT = '#7DD3FC';
/** Both round buttons: 40 px neon circles, centred on the digits' line. */
const ROUND_BUTTON =
  'neo3-neon neo3-neon-round absolute top-1/2 inline-flex h-10 w-10 -translate-y-1/2 overflow-hidden outline-none transition-transform duration-150 ease-out hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring active:scale-95';

function HomeMenuButton({ onMenuClick }: { onMenuClick: () => void }) {
  const { t } = useTranslation();
  // Same tap handling as the ☰ in the chat header (touchend, no ghost click).
  const { handleMobileMenuClick, handleMobileMenuTouchEnd } = useMobileMenuHandlers(onMenuClick);
  const label = t('mainContent.homeMenu', 'Open menu');

  return (
    <button
      type="button"
      className={`${ROUND_BUTTON} left-0 touch-manipulation`}
      onClick={handleMobileMenuClick}
      onTouchEnd={handleMobileMenuTouchEnd}
      aria-label={label}
      title={label}
      data-home-menu
    >
      <NeonTile glyph="menu" accent={ACCENT} size={40} shape="circle" showMark={false} className="h-full w-full" />
    </button>
  );
}

/**
 * The clock line of Home: digits in the middle, ☰ (phone) at the left edge of
 * the grid column and the settings gear at its right edge, both centred on
 * the digits. The buttons are absolute, so the digits stay centred and the
 * line is as tall as the digits — the ☰ strip that used to sit above it is
 * gone and its height goes to the grid (23.11 09:38).
 */
export default function HomeClockRow({ time, onMenuClick, onShowSettings }: HomeClockRowProps) {
  const { t } = useTranslation();
  const settingsLabel = t('mainContent.homeSettings', 'Settings');

  return (
    <div className="relative flex items-center justify-center" data-home-clock>
      {onMenuClick && <HomeMenuButton onMenuClick={onMenuClick} />}
      <p
        className="text-5xl font-semibold leading-none tracking-tight text-foreground sm:text-6xl"
        data-home-time
      >
        {time}
      </p>
      <button
        type="button"
        className={`${ROUND_BUTTON} right-0`}
        onClick={onShowSettings}
        aria-label={settingsLabel}
        title={settingsLabel}
        data-home-settings
      >
        <NeonTile glyph="settings" accent={ACCENT} size={40} shape="circle" showMark={false} className="h-full w-full" />
      </button>
    </div>
  );
}

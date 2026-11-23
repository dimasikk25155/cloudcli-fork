import React from 'react';
import { useTranslation } from 'react-i18next';

import NeonTile from '../app-icon/neon/NeonTile';

type HomeClockRowProps = {
  time: string;
  /** Computer only: the settings gear. On a phone settings are in the bottom bar. */
  onShowSettings?: () => void;
};

const ACCENT = '#7DD3FC';
/** The round button: a 40 px neon circle, centred on the digits' line. */
const ROUND_BUTTON =
  'neo3-neon neo3-neon-round absolute top-1/2 inline-flex h-10 w-10 -translate-y-1/2 overflow-hidden outline-none transition-transform duration-150 ease-out hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring active:scale-95';

/**
 * The clock line of Home: digits in the middle; on a computer the settings
 * gear at the right edge of the grid column, centred on the digits. It is
 * absolute, so the digits stay centred and the line is as tall as the digits.
 * A phone shows the digits alone — ☰ and settings moved to the bottom bar.
 */
export default function HomeClockRow({ time, onShowSettings }: HomeClockRowProps) {
  const { t } = useTranslation();
  const settingsLabel = t('mainContent.homeSettings', 'Settings');

  return (
    <div className="relative flex items-center justify-center" data-home-clock>
      <p
        className="text-5xl font-semibold leading-none tracking-tight text-foreground sm:text-6xl"
        data-home-time
      >
        {time}
      </p>
      {onShowSettings && (
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
      )}
    </div>
  );
}

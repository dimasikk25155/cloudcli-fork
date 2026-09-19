import { useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Home } from 'lucide-react';
import type { MainContentHeaderProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';
import PlannerAttentionButton from '../../../consigliere/PlannerAttentionButton';
import BotHealthButton from '../../../consigliere/BotHealthButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import MainContentTitle from './MainContentTitle';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowBrowserTab,
  shouldShowAutopilotTab,
  isMobile,
  onMenuClick,
  onGoHome,
}: MainContentHeaderProps) {
  const { t } = useTranslation('sidebar');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollState]);

  const homeButton = onGoHome ? (
    <button
      type="button"
      onClick={onGoHome}
      title={t('tooltips.goHome', 'Home screen')}
      aria-label={t('tooltips.goHome', 'Home screen')}
      className="pointer-events-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
    >
      <Home className="h-4 w-4" />
    </button>
  ) : null;

  return (
    <div className="pwa-header-safe flex-shrink-0 border-b border-border/60 bg-background px-3 py-1.5 sm:px-4 sm:py-2">
      <div className="relative flex items-center gap-3">
        {/* LEFT: mobile menu + compact title (mobile only) */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          {isMobile && homeButton}
          <div className="min-w-0 md:hidden">
            <MainContentTitle
              activeTab={activeTab}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
            />
          </div>
        </div>

        {/* CENTER: home + session title. Home sits in the empty space
            on the left of the title block, not in the far corner. */}
        <div className="main-content-title absolute left-1/2 top-1/2 hidden max-w-[52%] -translate-x-1/2 -translate-y-1/2 md:flex md:items-center md:gap-2">
          {homeButton}
          <div className="pointer-events-none min-w-0">
            <MainContentTitle
              activeTab={activeTab}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              centered
            />
          </div>
        </div>

        {/* RIGHT: bot health + overdue bell + tabs, pinned to the corner */}
        <div className="flex min-w-0 flex-shrink items-center gap-1.5 sm:flex-shrink-0">
          <BotHealthButton />
          <PlannerAttentionButton />
          <div className="relative min-w-0 overflow-hidden">
            {canScrollLeft && (
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
            )}
            <div
              ref={scrollRef}
              onScroll={updateScrollState}
              className="scrollbar-hide overflow-x-auto"
            >
              <MainContentTabSwitcher
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                shouldShowBrowserTab={shouldShowBrowserTab}
                shouldShowAutopilotTab={shouldShowAutopilotTab}
              />
            </div>
            {canScrollRight && (
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

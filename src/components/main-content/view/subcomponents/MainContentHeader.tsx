import { useCallback, useRef, useState, useEffect } from 'react';
import type { MainContentHeaderProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';
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
}: MainContentHeaderProps) {
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

  return (
    <div className="pwa-header-safe flex-shrink-0 border-b border-border/60 bg-background px-3 py-1.5 sm:px-4 sm:py-2">
      <div className="relative flex items-center gap-3">
        {/* LEFT: mobile menu + compact title (mobile only) */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          <div className="min-w-0 md:hidden">
            <MainContentTitle
              activeTab={activeTab}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
            />
          </div>
        </div>

        {/* CENTER: big session title (desktop) — absolutely centered so it never shifts */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden max-w-[40%] -translate-x-1/2 -translate-y-1/2 md:block">
          <MainContentTitle
            activeTab={activeTab}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            centered
          />
        </div>

        {/* RIGHT: tabs, pinned to the corner */}
        <div className="relative min-w-0 flex-shrink overflow-hidden sm:flex-shrink-0">
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
  );
}

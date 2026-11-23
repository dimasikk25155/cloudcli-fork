import { useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Home } from 'lucide-react';
import type { MainContentHeaderProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';
import PlannerAttentionButton from '../../../consigliere/PlannerAttentionButton';
import BotHealthButton from '../../../consigliere/BotHealthButton';
import CodeStatusChip from '../../../code-status/CodeStatusChip';
import { useModEnabled } from '../../../../hooks/useModEnabled';
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
  workbenchToggle,
  workbenchOn = false,
}: MainContentHeaderProps) {
  const { t } = useTranslation('sidebar');
  // «Где мой код» off in «Встроенные моды»: no chip, so no code-status request.
  const codeStatusOn = useModEnabled('modCodeStatus');
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

  const tabsFade = canScrollLeft || canScrollRight
    ? `linear-gradient(to right, ${canScrollLeft ? 'transparent' : '#000'} 0, #000 24px, #000 calc(100% - 24px), ${canScrollRight ? 'transparent' : '#000'} 100%)`
    : null;

  const homeButton = onGoHome ? (
    <button
      type="button"
      onClick={onGoHome}
      title={t('tooltips.goHome', 'Home screen')}
      aria-label={t('tooltips.goHome', 'Home screen')}
      className="glass-button pointer-events-auto h-9 w-9 flex-shrink-0 touch-manipulation text-foreground before:absolute before:-inset-1"
    >
      <Home className="h-4 w-4" />
    </button>
  ) : null;

  return (
    // Лист стекла вместо сплошной полосы: материал темы виден сквозь шапку,
    // кромка только снизу. z-10 — чтобы тень листа легла на ленту под ним.
    <div className="pwa-header-safe pwa-header-air glass-sheet relative z-10 flex-shrink-0 border-x-0 border-t-0 px-3 py-1.5 sm:px-4 sm:py-2">
      <div className="relative flex items-center gap-3">
        {/* LEFT: mobile menu + compact title (mobile only) */}
        {/* On a phone the menu and home buttons keep their room; the tabs
            scroller on the right absorbs the squeeze (it scrolls with fades). */}
        <div className={`flex flex-1 items-center gap-2 ${isMobile ? (onGoHome ? 'min-w-[5rem]' : 'min-w-9') : 'min-w-0'}`}>
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          {isMobile && homeButton}
          <div className="min-w-0 flex-1 md:hidden">
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
        <div className={`flex items-center gap-1.5 ${workbenchOn ? 'flex-shrink-0' : 'min-w-0 flex-shrink sm:flex-shrink-0'}`}>
          {(workbenchOn || activeTab === 'chat') && workbenchToggle}
          {codeStatusOn && activeTab === 'chat' && <CodeStatusChip projectId={selectedProject.projectId} />}
          <BotHealthButton />
          <PlannerAttentionButton />
          {!workbenchOn && (
          <div className="relative min-w-0 overflow-hidden">
            {/* Края ряда вкладок гаснут маской, а не градиентом цвета фона:
                под шапкой теперь стекло, и цветной градиент лёг бы пятном. */}
            <div
              ref={scrollRef}
              onScroll={updateScrollState}
              className="scrollbar-hide overflow-x-auto"
              style={tabsFade ? { maskImage: tabsFade, WebkitMaskImage: tabsFade } : undefined}
            >
              <MainContentTabSwitcher
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                shouldShowBrowserTab={shouldShowBrowserTab}
                shouldShowAutopilotTab={shouldShowAutopilotTab}
              />
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

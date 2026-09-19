import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import CommandPalette from '../command-palette/CommandPalette';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { PaletteOpsProvider, usePaletteOpsRegister } from '../../contexts/PaletteOpsContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useQueuedMessageAutoSend } from '../../hooks/useQueuedMessageAutoSend';
import { api } from '../../utils/api';
import { useTheme } from '../../contexts/ThemeContext';
import ThemeBackground from '../branding/ThemeBackground';
import LiveWallpaperCycleButton from '../branding/LiveWallpaperCycleButton';
import { computeKeyboardInsets } from './keyboard-insets';

type RunningSessionApiItem = {
  sessionId?: unknown;
  startedAt?: unknown;
  statusText?: unknown;
  canInterrupt?: unknown;
};

type RunningSessionsApiPayload = {
  data?: {
    sessions?: RunningSessionApiItem[];
  };
};

const parseStartedAt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default function AppContent() {
  return (
    <PaletteOpsProvider>
      <AppContentInner />
    </PaletteOpsProvider>
  );
}

function AppContentInner() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, subscribe } = useWebSocket();
  const { shaderEnabled, theme, playingVariant, customBackgroundUrl, cycleLiveWallpaper, liveWallpaperAuto } = useTheme();

  const {
    processingSessions,
    markSessionProcessing,
    markSessionIdle,
    syncProcessingSessions,
  } = useSessionProtection();

  const {
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    externalMessageUpdate,
    newSessionTrigger,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    openSettings,
    refreshProjectsSilently,
    registerOptimisticSession,
    sidebarSharedProps,
    handleNewSession,
    handleProjectSelect,
    goHome,
    handleToggleStar,
    projects,
  } = useProjectsState({
    sessionId,
    navigate,
    subscribe,
    isMobile,
    activeSessions: processingSessions,
  });

  // Queued messages for sessions that finish while another session (or none)
  // is being viewed are sent from here; the viewed session's composer handles
  // its own queue.
  useQueuedMessageAutoSend({
    processingSessions,
    activeSessionId: selectedSession?.id ?? sessionId ?? null,
    ws,
    sendMessage,
    markSessionProcessing,
  });

  const refreshRunningSessions = useCallback(async () => {
    try {
      const response = await api.runningSessions();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as RunningSessionsApiPayload;
      const sessions = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];

      syncProcessingSessions(
        sessions
          .map((session) => {
            if (typeof session.sessionId !== 'string' || !session.sessionId) {
              return null;
            }

            return {
              sessionId: session.sessionId,
              startedAt: parseStartedAt(session.startedAt),
              statusText: typeof session.statusText === 'string' ? session.statusText : undefined,
              canInterrupt: typeof session.canInterrupt === 'boolean' ? session.canInterrupt : undefined,
            };
          })
          .filter((session): session is NonNullable<typeof session> => Boolean(session)),
      );
    } catch (error) {
      console.error('[AppContent] Failed to sync running sessions:', error);
    }
  }, [syncProcessingSessions]);

  useEffect(() => {
    void refreshRunningSessions();
  }, [refreshRunningSessions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshRunningSessions();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [refreshRunningSessions]);

  usePaletteOpsRegister({
    openSettings,
    refreshProjects: refreshProjectsSilently,
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        localStorage.setItem('selected-provider', message.provider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      if (typeof message.urlPath === 'string' && message.urlPath.startsWith('/session/')) {
        navigate(message.urlPath);
        return;
      }

      // No resolvable session id in the payload. Never yank the user off a
      // session they're already viewing onto the empty New Session screen —
      // that's the "idle redirect" bug. Only fall back to the root when we
      // aren't already on a session route.
      if (!window.location.pathname.startsWith('/session/')) {
        navigate('/');
      }
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  // Pending tool permissions are recovered through the `chat.subscribe` flow:
  // the `chat_subscribed` ack carries them on session open and on reconnect,
  // so no separate permission-recovery message is needed here.

  // Keep the app shell glued to the visible part of the screen while the
  // on-screen keyboard is up. On Chrome for Android the layout viewport itself
  // shrinks, so inset-0 already follows. Every iOS browser (Safari, and Chrome
  // too — Apple only allows the WebKit engine) instead keeps the page at full
  // height, overlays the keyboard AND scrolls the visible window down so the
  // focused field clears it. Tracking only the height loss therefore fixes the
  // bottom edge but not the top: the shell keeps its origin at the layout
  // viewport, so its top slides off-screen and an equally tall dead strip is
  // left above the keyboard. We publish both the height loss and the shift,
  // and `.app-shell` (index.css) positions itself against the visible window.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;

    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const { offset, height } = computeKeyboardInsets(window.innerHeight, vv.height, vv.offsetTop);

      root.style.setProperty('--keyboard-offset', `${offset}px`);
      root.style.setProperty('--keyboard-height', `${height}px`);
    };

    // Both events fire in bursts while the keyboard animates; coalesce them
    // into one write per frame so the shell follows it smoothly.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    apply();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      root.style.removeProperty('--keyboard-offset');
      root.style.removeProperty('--keyboard-height');
    };
  }, []);

  return (
    <div className="app-shell fixed inset-0 flex">
      {/* Тема "Claude" — буквальный клон claude.ai: там фон статичный,
          без анимации, поэтому для неё фон-компонент не рендерим вообще.
          Для остальных тем фон рендерится ВСЕГДА: тумблер "Живой фон"
          выключает только движение, а не саму картинку — иначе тема
          схлопывалась в пустую заливку и переставала быть собой. */}
      {(theme !== 'claude' || customBackgroundUrl) && (
        <ThemeBackground
          theme={theme}
          enabled={shaderEnabled}
          variant={playingVariant}
          customUrl={customBackgroundUrl}
          onVideoEnded={liveWallpaperAuto ? cycleLiveWallpaper : undefined}
        />
      )}
      {!isMobile ? (
        <div className="app-sidebar relative z-10 h-full flex-shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} onGoHome={goHome} />
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`app-sidebar relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} onGoHome={goHome} />
          </div>
        </div>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <LiveWallpaperCycleButton />
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          projects={projects}
          onProjectSelect={handleProjectSelect}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionProcessing={markSessionProcessing}
          onSessionIdle={markSessionIdle}
          processingSessions={processingSessions}
          onNavigateToSession={(targetSessionId: string, options) =>
            navigate(`/session/${targetSessionId}`, { replace: Boolean(options?.replace) })
          }
          onSessionEstablished={(targetSessionId, context) =>
            registerOptimisticSession({ sessionId: targetSessionId, ...context })
          }
          onShowSettings={openSettings}
          onGoHome={goHome}
          onToggleStarProject={handleToggleStar}
          externalMessageUpdate={externalMessageUpdate}
          newSessionTrigger={newSessionTrigger}
          onStartNewChat={handleNewSession}
        />
      </div>

      <CommandPalette
        selectedProject={selectedProject}
        onStartNewChat={handleNewSession}
        onOpenSettings={() => openSettings()}
        onShowTab={setActiveTab}
      />
    </div>
  );
}

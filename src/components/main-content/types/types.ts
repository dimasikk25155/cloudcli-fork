import type { Dispatch, SetStateAction } from 'react';

import type { AppTab, Project, ProjectSession } from '../../../types/app';
import type {
  MarkSessionIdle,
  MarkSessionProcessing,
  SessionActivityMap,
} from '../../../hooks/useSessionProtection';
import type { SessionEstablishedContext, SessionNavigationOptions } from '../../chat/types/types';
import type { SettingsMainTab } from '../../settings/types/types';

export type MainContentProps = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  projects?: Project[];
  onProjectSelect?: (project: Project) => void;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  isMobile: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  onInputFocusChange: (focused: boolean) => void;
  onSessionProcessing: MarkSessionProcessing;
  onSessionIdle: MarkSessionIdle;
  processingSessions: SessionActivityMap;
  onNavigateToSession: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings: (tab?: SettingsMainTab) => void;
  onGoHome?: () => void;
  onToggleStarProject?: (projectId: string) => void;
  externalMessageUpdate: number;
  newSessionTrigger: number;
  /** Starts a brand-new chat in the current project (same path as the sidebar button). */
  onStartNewChat?: (project: Project) => void;
};

export type MainContentHeaderProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowBrowserTab: boolean;
  shouldShowAutopilotTab: boolean;
  isMobile: boolean;
  onMenuClick: () => void;
  onGoHome?: () => void;
};

export type MainContentStateViewProps = {
  mode: 'loading' | 'empty';
  isMobile: boolean;
  onMenuClick: () => void;
  projects?: Project[];
  onProjectSelect?: (project: Project) => void;
  onShowSettings?: (tab?: SettingsMainTab) => void;
  onToggleStarProject?: (projectId: string) => void;
};

export type MobileMenuButtonProps = {
  onMenuClick: () => void;
  compact?: boolean;
};

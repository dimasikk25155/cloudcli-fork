import type { Dispatch, SetStateAction } from 'react';

import type { LLMProvider } from '../../../types/app';
import type { ProviderAuthStatus } from '../../provider-auth/types';

export type SettingsMainTab = 'agents' | 'instruments' | 'appearance' | 'git' | 'api' | 'voice' | 'browser' | 'notifications' | 'telegram' | 'plugins' | 'admin' | 'about';
export type AgentProvider = LLMProvider;
export type AgentCategory = 'account' | 'defaults' | 'permissions' | 'mcp' | 'skills';
// One definition with the sidebar: Settings and the sidebar switch write the same device key.
export type { ProjectSortOrder } from '../../sidebar/types/types';
export type SaveStatus = 'success' | 'error' | null;
export type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export type SettingsProject = {
  name: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

export type AuthStatus = ProviderAuthStatus;

export type ClaudePermissionsState = {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
};

export type NotificationPreferencesState = {
  channels: {
    inApp: boolean;
    webPush: boolean;
    desktop: boolean;
    sound: boolean;
  };
  events: {
    actionRequired: boolean;
    stop: boolean;
    error: boolean;
  };
};

export type CursorPermissionsState = {
  allowedCommands: string[];
  disallowedCommands: string[];
  skipPermissions: boolean;
};

export type CodeEditorSettingsState = {
  wordWrap: boolean;
  showMinimap: boolean;
  lineNumbers: boolean;
  fontSize: string;
};

export type SettingsStoragePayload = {
  claude: ClaudePermissionsState & { lastUpdated: string };
  cursor: CursorPermissionsState & { lastUpdated: string };
  codex: { permissionMode: CodexPermissionMode; lastUpdated: string };
};

export type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: SettingsProject[];
  initialTab?: string;
};

export type SetState<T> = Dispatch<SetStateAction<T>>;

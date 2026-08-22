import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type {
  MarkSessionIdle,
  MarkSessionProcessing,
  SessionActivityMap,
} from '../../../hooks/useSessionProtection';

export type Provider = LLMProvider;

/**
 * Three backend modes: ask (default), never ask (bypassPermissions) and
 * read-only (plan). See PROVIDER_CAPABILITIES in
 * server/modules/providers/services/provider-capabilities.service.ts.
 *
 * `planBypass` is a fourth, UI-only mode: it runs as `plan` on the wire and the
 * client approves the plan (and everything after it) by itself — see
 * ../utils/autoPlanMode.
 */
export type PermissionMode = 'default' | 'bypassPermissions' | 'plan' | 'planBypass';

/**
 * How much the agent checks in while it works — a different axis from
 * PermissionMode, which only decides whether a tool call needs an OK.
 * Mirrors WORK_MODES in server/shared/work-mode.ts.
 */
export type WorkMode = 'autopilot' | 'checkpoints' | 'interrogate' | 'build';

export const WORK_MODES: WorkMode[] = ['autopilot', 'checkpoints', 'interrogate', 'build'];

export interface ChatImage {
  /** Inline data URL (Claude history stores attachments as base64). */
  data?: string;
  /** Project-relative path under `.cloudcli/assets` served via the files API. */
  path?: string;
  name?: string;
  mimeType?: string;
}

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export interface SubagentChildTool {
  toolId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResult | null;
  timestamp: Date;
}

export interface ChatMessage {
  type: string;
  content?: string;
  displayText?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  reasoning?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  [key: string]: unknown;
}

export interface ClaudeSettings {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  projectSortOrder: string;
  lastUpdated?: string;
  [key: string]: unknown;
}

export interface ClaudePermissionSuggestion {
  toolName: string;
  entry: string;
  isAllowed: boolean;
}

export interface PermissionGrantResult {
  success: boolean;
  alreadyAllowed?: boolean;
  updatedSettings?: ClaudeSettings;
}

export interface PendingPermissionRequest {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
  receivedAt?: Date;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export type SessionNavigationOptions = {
  replace?: boolean;
};

export type SessionEstablishedContext = {
  provider: LLMProvider;
  project: Project;
  summary?: string | null;
};

export interface ChatInterfaceProps {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  processingSessions?: SessionActivityMap;
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings?: () => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
  sendByCtrlEnter?: boolean;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  /**
   * Opens a fresh chat in the same project. Used when the model picker is asked
   * for a model belonging to another engine while a session is already running:
   * a session belongs to one CLI, so the switch has to happen in a new chat.
   */
  onStartNewChat?: () => void;
  onTaskClick?: (...args: unknown[]) => void;
  onShowAllTasks?: (() => void) | null;
}

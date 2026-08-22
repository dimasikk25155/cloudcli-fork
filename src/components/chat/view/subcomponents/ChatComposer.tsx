import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  TouchEvent,
} from 'react';
import { Plus, XIcon, Loader2, ChevronDown, Check, ArrowUpIcon, Rocket, ListChecks, HelpCircle, Gauge } from 'lucide-react';

import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';
import type { QueuedDraft } from '../../hooks/useChatComposerState';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import { WORK_MODES } from '../../types/types';
import type { PendingPermissionRequest, PermissionMode, WorkMode } from '../../types/types';
import type { ProviderModelOption } from '../../../../types/app';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '../../../../shared/view/ui';

import CommandMenu from './CommandMenu';
import ActivityIndicator from './ActivityIndicator';
import ImageAttachment from './ImageAttachment';
import VoiceInputButton from './VoiceInputButton';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import TokenUsageSummary from './TokenUsageSummary';
import UsageLimitsBadge from './UsageLimitsBadge';
import QueuedMessageCard from './QueuedMessageCard';

interface MentionableFile {
  name: string;
  path: string;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  activity: SessionActivity | null;
  isLoading: boolean;
  onAbortSession: () => void;
  onAppendNow: () => void;
  isAppendPending: boolean;
  permissionMode: PermissionMode | string;
  availablePermissionModes: PermissionMode[];
  onSelectPermissionMode: (mode: PermissionMode) => void;
  workMode: WorkMode;
  onSelectWorkMode: (mode: WorkMode) => void;
  /** False for providers whose runtime has no system-prompt hook to carry the mode. */
  isWorkModeSupported: boolean;
  model: string;
  availableModelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  effort: string;
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  tokenBudget: Record<string, unknown> | null;
  onShowTokenUsage: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
  attachedImages: File[];
  onRemoveImage: (index: number) => void;
  uploadingImages: Map<string, number>;
  imageErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openImagePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onVoiceTranscript?: (text: string, send?: boolean) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  isInputFocused?: boolean;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
}

// Dot + button tints per permission mode, shared by the trigger button and
// the dropdown items so the color legend stays consistent.
// The legend reads as a scale: grey = asks about everything, blue = touches
// nothing (plan), orange = asks about nothing (bypass). Plan used to fall
// through to the accent colour, which made it look identical to bypass — the
// two least similar modes wearing the same dot.
const MODE_DOT_CLASS: Record<string, string> = {
  default: 'bg-muted-foreground',
  plan: 'bg-blue-500',
  bypassPermissions: 'bg-orange-500',
  // Plan + auto-run sits between the two, so it gets the colour between them.
  planBypass: 'bg-violet-500',
};
const MODE_BUTTON_CLASS: Record<string, string> = {
  default: 'border-border/60 bg-muted/50 hover:bg-muted',
  plan: 'border-blue-300/60 bg-blue-50 hover:bg-blue-100 dark:border-blue-600/40 dark:bg-blue-900/15 dark:hover:bg-blue-900/25',
  bypassPermissions: 'border-orange-300/60 bg-orange-50 hover:bg-orange-100 dark:border-orange-600/40 dark:bg-orange-900/15 dark:hover:bg-orange-900/25',
  planBypass: 'border-violet-300/60 bg-violet-50 hover:bg-violet-100 dark:border-violet-600/40 dark:bg-violet-900/15 dark:hover:bg-violet-900/25',
};
const modeDotClass = (mode: string) => MODE_DOT_CLASS[mode] ?? 'bg-primary';
const modeButtonClass = (mode: string) => MODE_BUTTON_CLASS[mode] ?? 'border-primary/20 bg-primary/5 hover:bg-primary/10';

// Work mode is a behaviour switch, not a risk level, so it gets an icon
// instead of the permission chip's colour-coded dot.
const WORK_MODE_ICON: Record<WorkMode, typeof Rocket> = {
  autopilot: Rocket,
  checkpoints: ListChecks,
  interrogate: HelpCircle,
  // Та же шкала, что на вкладке дашборда — режим и его экран узнаются вместе.
  build: Gauge,
};

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  activity,
  isLoading,
  onAbortSession,
  onAppendNow,
  isAppendPending,
  permissionMode,
  availablePermissionModes,
  onSelectPermissionMode,
  workMode,
  onSelectWorkMode,
  isWorkModeSupported,
  model,
  availableModelOptions,
  onSelectModel,
  effort,
  availableEffortOptions,
  onSelectEffort,
  tokenBudget,
  onShowTokenUsage,
  hasInput,
  onClearInput,
  onSubmit,
  isDragActive,
  queuedDraft,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  attachedImages,
  onRemoveImage,
  uploadingImages,
  imageErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openImagePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onVoiceTranscript,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  isInputFocused = false,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const commandMenuPosition = useMemo(() => {
    if (!isCommandMenuOpen) {
      return { top: 0, left: 16, bottom: 90 };
    }
    const textareaRect = textareaRef.current?.getBoundingClientRect();
    return {
      top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
      left: textareaRect ? textareaRect.left : 16,
      bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
    };
  }, [isCommandMenuOpen, textareaRef]);

  // Voice state is hosted here (not in the mic button) so the main Send button can stop
  // recording and send the transcript in one tap, the way the mic button drops it in the box.
  const voiceAvailable = useVoiceAvailable();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVoiceError = useCallback((msg: string) => {
    setVoiceError(msg);
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = setTimeout(() => setVoiceError(null), 4000);
  }, []);
  useEffect(() => () => {
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
  }, []);
  const noopTranscript = useCallback(() => {}, []);
  const {
    state: voiceState,
    toggle: voiceToggle,
    stop: voiceStop,
    discard: voiceDiscard,
    getLevel: voiceLevel,
    getElapsedMs: voiceElapsed,
  } = useVoiceInput(onVoiceTranscript ?? noopTranscript, handleVoiceError);
  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';
  // While a failed recording is waiting to be retried, keep the reason on screen
  // instead of letting the 4s auto-hide leave an unexplained retry button.
  useEffect(() => {
    if (voiceState !== 'error' && voiceErrorTimer.current) return;
    if (voiceState === 'error' && voiceErrorTimer.current) {
      clearTimeout(voiceErrorTimer.current);
      voiceErrorTimer.current = null;
    }
    if (voiceState === 'idle') setVoiceError(null);
  }, [voiceState]);
  const [isEffortDropdownOpen, setIsEffortDropdownOpen] = useState(false);
  const effortDropdownRef = useRef<HTMLDivElement | null>(null);
  const effortDropdownMenuRef = useRef<HTMLDivElement | null>(null);
  const effortDropdownButtonRef = useRef<HTMLButtonElement | null>(null);
  const [effortDropdownPosition, setEffortDropdownPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement | null>(null);
  const modeDropdownMenuRef = useRef<HTMLDivElement | null>(null);
  const modeDropdownButtonRef = useRef<HTMLButtonElement | null>(null);
  const [modeDropdownPosition, setModeDropdownPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const [isWorkModeDropdownOpen, setIsWorkModeDropdownOpen] = useState(false);
  const workModeDropdownRef = useRef<HTMLDivElement | null>(null);
  const workModeDropdownMenuRef = useRef<HTMLDivElement | null>(null);
  const workModeDropdownButtonRef = useRef<HTMLButtonElement | null>(null);
  const [workModeDropdownPosition, setWorkModeDropdownPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const modelDropdownMenuRef = useRef<HTMLDivElement | null>(null);
  const modelDropdownButtonRef = useRef<HTMLButtonElement | null>(null);
  const [modelDropdownPosition, setModelDropdownPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const effortOptions = useMemo(
    () => [{ value: 'default' }, ...availableEffortOptions],
    [availableEffortOptions],
  );
  // The trigger buttons show the CURRENT choice (claude.ai-style "Fable 5" /
  // "High"), falling back to the generic label only when nothing concrete is
  // selected.
  const selectedModelOption = useMemo(
    () => availableModelOptions.find((candidate) => candidate.value === model) ?? null,
    [availableModelOptions, model],
  );
  const selectedModelLabel = selectedModelOption?.label ?? (model || null);
  // The catalog has always carried a `description` per model; it used to be
  // dropped on the floor. It matters now that Grok's entries are modes
  // (Быстрый / Эксперт / Тяжёлый) whose name alone says nothing about which
  // model or thinking level is behind them. A wider menu only when there is
  // something to put in it, so providers without descriptions look unchanged.
  const hasModelDescriptions = useMemo(
    () => availableModelOptions.some((candidate) => Boolean(candidate.description)),
    [availableModelOptions],
  );
  // "default" is not a level a human recognises — show the level the model
  // actually runs at, which is the catalog's declared default for it.
  const selectedEffortLabel = effort && effort !== 'default'
    ? effort
    : selectedModelOption?.effort?.default ?? null;
  const updateEffortDropdownPosition = useCallback(() => {
    const rect = effortDropdownButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setEffortDropdownPosition({
      left: rect.left,
      top: rect.top - 8,
      maxHeight: Math.max(96, rect.top - 16),
    });
  }, []);

  useEffect(() => {
    if (!isEffortDropdownOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !effortDropdownRef.current?.contains(target)
        && !effortDropdownMenuRef.current?.contains(target)
      ) {
        setIsEffortDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsEffortDropdownOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updateEffortDropdownPosition);
    window.addEventListener('scroll', updateEffortDropdownPosition, true);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    updateEffortDropdownPosition();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updateEffortDropdownPosition);
      window.removeEventListener('scroll', updateEffortDropdownPosition, true);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isEffortDropdownOpen, updateEffortDropdownPosition]);

  const updateModelDropdownPosition = useCallback(() => {
    const rect = modelDropdownButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setModelDropdownPosition({
      left: rect.left,
      top: rect.top - 8,
      maxHeight: Math.max(96, rect.top - 16),
    });
  }, []);

  const updateModeDropdownPosition = useCallback(() => {
    const rect = modeDropdownButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setModeDropdownPosition({
      left: rect.left,
      top: rect.top - 8,
      maxHeight: Math.max(96, rect.top - 16),
    });
  }, []);

  useEffect(() => {
    if (!isModeDropdownOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !modeDropdownRef.current?.contains(target)
        && !modeDropdownMenuRef.current?.contains(target)
      ) {
        setIsModeDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsModeDropdownOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updateModeDropdownPosition);
    window.addEventListener('scroll', updateModeDropdownPosition, true);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    updateModeDropdownPosition();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updateModeDropdownPosition);
      window.removeEventListener('scroll', updateModeDropdownPosition, true);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isModeDropdownOpen, updateModeDropdownPosition]);

  const updateWorkModeDropdownPosition = useCallback(() => {
    const rect = workModeDropdownButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setWorkModeDropdownPosition({
      left: rect.left,
      top: rect.top - 8,
      maxHeight: Math.max(96, rect.top - 16),
    });
  }, []);

  useEffect(() => {
    if (!isWorkModeDropdownOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !workModeDropdownRef.current?.contains(target)
        && !workModeDropdownMenuRef.current?.contains(target)
      ) {
        setIsWorkModeDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsWorkModeDropdownOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updateWorkModeDropdownPosition);
    window.addEventListener('scroll', updateWorkModeDropdownPosition, true);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    updateWorkModeDropdownPosition();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updateWorkModeDropdownPosition);
      window.removeEventListener('scroll', updateWorkModeDropdownPosition, true);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isWorkModeDropdownOpen, updateWorkModeDropdownPosition]);

  useEffect(() => {
    if (!isModelDropdownOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !modelDropdownRef.current?.contains(target)
        && !modelDropdownMenuRef.current?.contains(target)
      ) {
        setIsModelDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsModelDropdownOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updateModelDropdownPosition);
    window.addEventListener('scroll', updateModelDropdownPosition, true);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    updateModelDropdownPosition();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updateModelDropdownPosition);
      window.removeEventListener('scroll', updateModelDropdownPosition, true);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isModelDropdownOpen, updateModelDropdownPosition]);

  // Menu items in the Mode/Model/Effort dropdowns live inside an
  // overflow-y-auto container. On real touch devices (most visible in the
  // Android TWA app) the browser's tap-vs-scroll arbitration treats even
  // tiny finger jitter during a tap as the start of a scroll on that
  // scrollable container and suppresses the synthetic `click` entirely —
  // the option never registers and the menu just sits there open. `touchend`
  // always fires regardless of that arbitration, so it drives the actual
  // selection on touch; `onClick` stays as the mouse/keyboard path. The
  // suppress-ref (same shape as useMobileMenuHandlers' pattern) stops the
  // click that normally follows a clean tap from firing the selection twice.
  const suppressNextOptionClickRef = useRef(false);
  const tapSelect = useCallback((onSelect: () => void) => ({
    onTouchEnd: (event: TouchEvent<HTMLButtonElement>) => {
      event.preventDefault();
      suppressNextOptionClickRef.current = true;
      onSelect();
      window.setTimeout(() => {
        suppressNextOptionClickRef.current = false;
      }, 350);
    },
    onClick: () => {
      if (suppressNextOptionClickRef.current) {
        suppressNextOptionClickRef.current = false;
        return;
      }
      onSelect();
    },
  }), []);

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  // Hide the thinking/status bar while a permission request is pending here —
  // the banner takes that spot. The plan approval is the exception: the banner
  // drops it (PlanDisplay renders it inline in the transcript), so hiding the
  // indicator for it leaves the composer showing nothing at all — the run looks
  // dead while every typed message silently lands in the queue.
  const bannerPermissionRequests = pendingPermissionRequests.filter(
    (request) => request.toolName !== 'ExitPlanMode' && request.toolName !== 'exit_plan_mode',
  );
  const hasPendingPermissions = bannerPermissionRequests.length > 0;
  const hasActivityIndicator = Boolean(activity && !hasPendingPermissions);

  const hasQueuedDraft = Boolean(queuedDraft);
  const canQueueDraft = isLoading && Boolean(input.trim());
  const submitAriaLabel = canQueueDraft
    ? hasQueuedDraft
      ? t('input.queue.update', { defaultValue: 'Update queued message' })
      : t('input.queue.sendNext', { defaultValue: 'Queue next message' })
    : isLoading
      ? t('input.stop')
      : t('input.send');

  return (
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-2 pt-0 sm:px-4 sm:pb-4 md:px-4 md:pb-6">
      {!hasPendingPermissions && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 w-[calc(100%-1rem)] max-w-[54.25rem] -translate-x-1/2 translate-y-px bg-transparent sm:w-[calc(100%-2rem)]">
          <ActivityIndicator activity={activity} onAbort={onAbortSession} isInputFocused={isInputFocused} />
        </div>
      )}

      {hasPendingPermissions && (
        <div className="mx-auto mb-3 max-w-[54.25rem]">
          <PermissionRequestsBanner
            pendingPermissionRequests={bannerPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
          />
        </div>
      )}

      {queuedDraft && (
        <QueuedMessageCard
          content={queuedDraft.content}
          imageCount={queuedDraft.images.length}
          onEdit={onEditQueuedDraft}
          onDelete={onDeleteQueuedDraft}
          onSendNow={onAppendNow}
          canSendNow={isLoading}
          isSendingNow={isAppendPending}
        />
      )}

      {!hasQuestionPanel && <div className="relative mx-auto max-w-[54.25rem]">
        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 shadow-lg backdrop-blur-md">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptInput
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status={isLoading ? 'streaming' : 'ready'}
          className={[
            isTextareaExpanded ? 'chat-input-expanded' : '',
            hasActivityIndicator ? 'rounded-t-none' : '',
          ].filter(Boolean).join(' ')}
          {...getRootProps()}
        >
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
              <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">Drop files here</p>
              </div>
            </div>
          )}

          {attachedImages.length > 0 && (
            <PromptInputHeader>
              <div className="rounded-xl bg-muted/40 p-2">
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map((file, index) => (
                    <ImageAttachment
                      key={index}
                      file={file}
                      onRemove={() => onRemoveImage(index)}
                      uploadProgress={uploadingImages.get(file.name)}
                      error={imageErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            </PromptInputHeader>
          )}

          <input {...getInputProps()} />

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-sm leading-6 text-transparent">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              dir="auto"
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
            />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools className="no-scrollbar min-w-0 flex-1 overflow-x-auto">
            <PromptInputButton
              tooltip={{ content: t('input.attachFiles', { defaultValue: 'Attach files' }) }}
              onClick={openImagePicker}
            >
              <Plus />
            </PromptInputButton>

            <div ref={modeDropdownRef} className="relative">
              <button
                ref={modeDropdownButtonRef}
                type="button"
                onClick={() => {
                  updateModeDropdownPosition();
                  setIsModeDropdownOpen((current) => !current);
                }}
                className={`composer-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${modeButtonClass(permissionMode)}`}
                aria-haspopup="menu"
                aria-expanded={isModeDropdownOpen}
                title={t('codex.permissionMode', { defaultValue: 'Permission mode' })}
                aria-label={t('codex.permissionMode', { defaultValue: 'Permission mode' })}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${modeDotClass(permissionMode)}`} />
              </button>

              {isModeDropdownOpen && modeDropdownPosition && createPortal(
                <div
                  ref={modeDropdownMenuRef}
                  className="fixed z-[100] min-w-44 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
                  style={{
                    left: modeDropdownPosition.left,
                    top: modeDropdownPosition.top,
                    maxHeight: modeDropdownPosition.maxHeight,
                    transform: 'translateY(-100%)',
                  }}
                  role="menu"
                >
                  {availablePermissionModes.map((mode) => {
                    const isSelected = mode === permissionMode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        {...tapSelect(() => {
                          onSelectPermissionMode(mode);
                          setIsModeDropdownOpen(false);
                        })}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${modeDotClass(mode)}`} />
                        <span>{t(`codex.modes.${mode}`, { defaultValue: mode })}</span>
                        <span className="ml-auto flex h-3 w-3 items-center justify-center">
                          {isSelected && <Check className="h-3 w-3 text-primary" />}
                        </span>
                      </button>
                    );
                  })}
                </div>,
                document.body,
              )}
            </div>

            {isWorkModeSupported && (
              <div ref={workModeDropdownRef} className="relative">
                <button
                  ref={workModeDropdownButtonRef}
                  type="button"
                  onClick={() => {
                    updateWorkModeDropdownPosition();
                    setIsWorkModeDropdownOpen((current) => !current);
                  }}
                  className="composer-chip flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 text-xs font-medium text-foreground transition-all duration-200 hover:bg-muted"
                  aria-haspopup="menu"
                  aria-expanded={isWorkModeDropdownOpen}
                  title={t('workMode.title', { defaultValue: 'Work mode' })}
                  aria-label={t('workMode.title', { defaultValue: 'Work mode' })}
                >
                  {(() => {
                    const WorkModeIcon = WORK_MODE_ICON[workMode];
                    return <WorkModeIcon className="h-3.5 w-3.5 text-muted-foreground" />;
                  })()}
                  <span>{t(`workMode.modes.${workMode}`, { defaultValue: workMode })}</span>
                </button>

                {isWorkModeDropdownOpen && workModeDropdownPosition && createPortal(
                  <div
                    ref={workModeDropdownMenuRef}
                    className="fixed z-[100] w-64 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
                    style={{
                      left: workModeDropdownPosition.left,
                      top: workModeDropdownPosition.top,
                      maxHeight: workModeDropdownPosition.maxHeight,
                      transform: 'translateY(-100%)',
                    }}
                    role="menu"
                  >
                    {WORK_MODES.map((mode) => {
                      const isSelected = mode === workMode;
                      const WorkModeIcon = WORK_MODE_ICON[mode];
                      return (
                        <button
                          key={mode}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          {...tapSelect(() => {
                            onSelectWorkMode(mode);
                            setIsWorkModeDropdownOpen(false);
                          })}
                          className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                            isSelected
                              ? 'bg-accent text-foreground'
                              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
                          }`}
                        >
                          <WorkModeIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">
                              {t(`workMode.modes.${mode}`, { defaultValue: mode })}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                              {t(`workMode.descriptions.${mode}`, { defaultValue: '' })}
                            </span>
                          </span>
                          <span className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center">
                            {isSelected && <Check className="h-3 w-3 text-primary" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>,
                  document.body,
                )}
              </div>
            )}

            {availableModelOptions.length > 0 && (
              <div ref={modelDropdownRef} className="relative">
                <button
                  ref={modelDropdownButtonRef}
                  type="button"
                  onClick={() => {
                    updateModelDropdownPosition();
                    setIsModelDropdownOpen((current) => !current);
                  }}
                  className="composer-chip composer-chip-model flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 text-xs font-medium text-foreground transition-all duration-200 hover:bg-muted"
                  aria-haspopup="menu"
                  aria-expanded={isModelDropdownOpen}
                  aria-label={t('input.selectModel')}
                  title={t('input.selectModel')}
                >
                  <span>{selectedModelLabel ?? t('input.modelLabel')}</span>
                  <ChevronDown className={`composer-chip-chevron h-3 w-3 text-muted-foreground transition-transform ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isModelDropdownOpen && modelDropdownPosition && createPortal(
                  <div
                    ref={modelDropdownMenuRef}
                    className={`fixed z-[100] overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg ${
                      hasModelDescriptions ? 'w-64' : 'min-w-44'
                    }`}
                    style={{
                      left: modelDropdownPosition.left,
                      top: modelDropdownPosition.top,
                      maxHeight: modelDropdownPosition.maxHeight,
                      transform: 'translateY(-100%)',
                    }}
                    role="menu"
                  >
                    {availableModelOptions.map((option) => {
                      const isSelected = option.value === model;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          {...tapSelect(() => {
                            onSelectModel(option.value);
                            setIsModelDropdownOpen(false);
                          })}
                          className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                            isSelected
                              ? 'bg-accent text-foreground'
                              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
                          }`}
                        >
                          <span className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center">
                            {isSelected && <Check className="h-3 w-3 text-primary" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{option.label ?? option.value}</span>
                            {option.description && (
                              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                                {option.description}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>,
                  document.body,
                )}
              </div>
            )}

            {availableEffortOptions.length > 0 && (
              <div ref={effortDropdownRef} className="relative">
                <button
                  ref={effortDropdownButtonRef}
                  type="button"
                  onClick={() => {
                    updateEffortDropdownPosition();
                    setIsEffortDropdownOpen((current) => !current);
                  }}
                  className="composer-chip composer-chip-effort flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 text-xs font-medium text-foreground transition-all duration-200 hover:bg-muted"
                  aria-haspopup="menu"
                  aria-expanded={isEffortDropdownOpen}
                  aria-label="Select reasoning effort"
                  title="Select reasoning effort"
                >
                  <span className={selectedEffortLabel ? 'capitalize' : undefined}>
                    {selectedEffortLabel ?? t('input.effortLabel', { defaultValue: 'Effort' })}
                  </span>
                  <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isEffortDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isEffortDropdownOpen && effortDropdownPosition && createPortal(
                  <div
                    ref={effortDropdownMenuRef}
                    className="fixed z-[100] min-w-36 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
                    style={{
                      left: effortDropdownPosition.left,
                      top: effortDropdownPosition.top,
                      maxHeight: effortDropdownPosition.maxHeight,
                      transform: 'translateY(-100%)',
                    }}
                    role="menu"
                  >
                    {effortOptions.map((option) => {
                      const isSelected = option.value === effort;
                      const label = option.value === 'default' ? 'Default' : option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          {...tapSelect(() => {
                            onSelectEffort(option.value);
                            setIsEffortDropdownOpen(false);
                          })}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs capitalize transition-colors ${
                            isSelected
                              ? 'bg-accent text-foreground'
                              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
                          }`}
                        >
                          <span className="flex h-3 w-3 items-center justify-center">
                            {isSelected && <Check className="h-3 w-3 text-primary" />}
                          </span>
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>,
                  document.body,
                )}
              </div>
            )}

            <TokenUsageSummary usage={tokenBudget} onClick={onShowTokenUsage} />

            <UsageLimitsBadge model={model} />

            {hasInput && (
              <PromptInputButton
                tooltip={{ content: t('input.clearInput', { defaultValue: 'Clear input' }) }}
                onClick={onClearInput}
                className="hidden sm:flex"
              >
                <XIcon />
              </PromptInputButton>
            )}

          </PromptInputTools>

          <div className="flex shrink-0 items-center gap-2 pl-2">
            {onVoiceTranscript && voiceAvailable && (
              <VoiceInputButton
                state={voiceState}
                onToggle={voiceToggle}
                errorMsg={voiceError}
                onDiscard={voiceDiscard}
                getLevel={voiceLevel}
                getElapsedMs={voiceElapsed}
              />
            )}
            <PromptInputSubmit
              onClick={
                canQueueDraft
                  ? (e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      onSubmit(e);
                    }
                  : isLoading
                    ? onAbortSession
                    : isRecording
                      ? (e: MouseEvent<HTMLButtonElement>) => {
                          e.preventDefault();
                          voiceStop({ send: true });
                        }
                      : undefined
              }
              disabled={isLoading ? false : isRecording ? false : isTranscribing ? true : !input.trim()}
              aria-label={submitAriaLabel}
              title={submitAriaLabel}
              className="composer-submit h-10 w-14 sm:w-16"
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : canQueueDraft ? (
                <ArrowUpIcon className="h-4 w-4" />
              ) : undefined}
            </PromptInputSubmit>
          </div>
        </PromptInputFooter>
      </PromptInput>
      </div>}
    </div>
  );
}

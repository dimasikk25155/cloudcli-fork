import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon } from 'lucide-react';

import { SELECTABLE_PROVIDERS, selectableModels } from '../../../utils/providerSelectionPolicy';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import PermissionContext, { type PermissionContextValue } from '../../../contexts/PermissionContext';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { ChatInterfaceProps, Provider  } from '../types/types';
import { useChatProviderState, readDefaultChatProvider } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useConnectionWatchdog } from '../hooks/useConnectionWatchdog';
import { useSessionStore } from '../../../stores/useSessionStore';
import { decisionExitsPlanMode, permissionModeAfterPlanApproval } from '../utils/planMode';
import { AUTO_PLAN_MODE, autoApprovedRequestIds, isAutoPlanMode } from '../utils/autoPlanMode';

// Engines whose models share one list in the composer's model chip: picking
// "Grok 4.6" right under "Fable 5.1" starts the chat on Grok, and picking Opus
// from a Grok chip switches back — no trip through the provider dialog. Order
// is preserved, and the current engine's own models always come first.
// Only applies to a chat that has no session yet: an existing session belongs
// to exactly one CLI and cannot change engines mid-flight.
// 17.09.2026: Codex joined — every subscription model of the three vendors
// (Anthropic / OpenAI / xAI) is one tap away, filed under a vendor header.
const COMPOSER_CROSS_ENGINE_PROVIDERS = SELECTABLE_PROVIDERS;
const COMPOSER_MODEL_GROUP_LABELS: Partial<Record<Provider, string>> = {
  claude: 'Anthropic',
  codex: 'OpenAI',
  grok: 'xAI',
};

import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import PinnedUserMessage from './subcomponents/PinnedUserMessage';
import ChatComposer from './subcomponents/ChatComposer';
import CommandResultModal from './subcomponents/CommandResultModal';

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  showRawParameters,
  showThinking,
  sendByCtrlEnter,
  sendByDoubleEnter,
  externalMessageUpdate,
  newSessionTrigger,
  onStartNewChat,
}: ChatInterfaceProps) {
  const { subscribe, isConnected, getLastFrameAt, forceReconnect } = useWebSocket();
  const { t } = useTranslation('chat');

  const sessionStore = useSessionStore();
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  // When each session's `chat.subscribe` was last sent; idle acks older than
  // a later local request are discarded as stale.
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // Highest live `seq` observed per session. Written by the realtime handler
  // on every sequenced frame, read whenever a `chat.subscribe` is sent so the
  // server replays only the events this client actually missed.
  const lastSeqRef = useRef(new Map<string, number>());

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    accumulatedStreamRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    opencodeModel,
    setOpenCodeModel,
    kimiModel,
    setKimiModel,
    geminiModel,
    setGeminiModel,
    grokModel,
    setGrokModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
    selectPermissionMode,
    workMode,
    selectWorkMode,
    resetComposerModesAfterSend,
    supportsWorkModeForProvider,
    commitWorkModeToSession,
    availablePermissionModes,
    providerModels,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsLoading,
    providerModelsRefreshing,
    hardRefreshProviderModels,
    selectProviderModel,
    selectProviderEffort,
    resolvePermissionModeForProvider,
    commitPermissionModeToSession,
    commitSessionModelAndEffort,
  } = useChatProviderState({
    selectedSession,
    selectedProject,
  });

  // Claude's "plan + bypass" auto-approves ExitPlanMode during the SAME run
  // that was started in that mode. The chip snaps back to ordinary + bypass
  // the moment the send is dispatched, so auto-approve reads this latch
  // instead of the chip — otherwise the plan prompt would sit waiting for
  // a tap the user never meant to make.
  const autoPlanRunActiveRef = useRef(false);

  const {
    chatMessages,
    addMessage,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    refreshTokenUsage,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    externalMessageUpdate,
    newSessionTrigger,
    processingSessions,
    onSessionIdle,
    resetStreamingState,
    statusCheckSentAtRef,
    lastSeqRef,
    sessionStore,
  });

  // "New chat" pressed: if Settings names an engine every new chat opens on,
  // move the composer there. Only on the explicit trigger — a provider picked
  // by hand for the draft afterwards is never snapped back (no other deps).
  const appliedNewSessionTriggerRef = useRef(newSessionTrigger);
  useEffect(() => {
    if (newSessionTrigger === appliedNewSessionTriggerRef.current) {
      return;
    }
    appliedNewSessionTriggerRef.current = newSessionTrigger;
    const preferred = readDefaultChatProvider();
    if (preferred && preferred !== provider) {
      setProvider(preferred);
      localStorage.setItem('selected-provider', preferred);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when the trigger moves
  }, [newSessionTrigger]);

  // Brand-new conversation: the composer allocated a stable session id via
  // the session gateway before the first send. Record it locally and put it
  // in the URL — this id never changes again, so there is no later handoff.
  const handleSessionEstablished = useCallback<NonNullable<ChatInterfaceProps['onSessionEstablished']>>((sessionId, context) => {
    setCurrentSessionId(sessionId);
    // The chips picked while composing (no session id yet) become this
    // chat's own record right now — see commitPermissionModeToSession.
    // The send path then one-shot-resets them to ordinary + bypass, so
    // this commit is the mode of the FIRST message, not a sticky default.
    commitPermissionModeToSession(sessionId);
    commitWorkModeToSession(sessionId);
    // Same story for the model and thinking level picked on the empty screen:
    // in-chat picks are session-scoped now, so they need a session to land on.
    commitSessionModelAndEffort(sessionId);
    onSessionEstablished?.(sessionId, context);
    onNavigateToSession?.(sessionId);
  }, [setCurrentSessionId, commitPermissionModeToSession, commitWorkModeToSession, commitSessionModelAndEffort, onSessionEstablished, onNavigateToSession]);

  const handleComposerModesConsumed = useCallback((sessionId: string) => {
    if (isAutoPlanMode(permissionMode)) {
      autoPlanRunActiveRef.current = true;
    }
    resetComposerModesAfterSend(sessionId);
  }, [permissionMode, resetComposerModesAfterSend]);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker,
    handleSubmit,
    queuedDraft,
    editQueuedDraft,
    deleteQueuedDraft,
    handleVoiceTranscript,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleAppendNow,
    isAppendPending,
    handlePermissionDecision: sendPermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    permissionMode,
    workMode,
    cyclePermissionMode,
    cursorModel,
    claudeModel,
    codexModel,
    currentProviderEffort,
    opencodeModel,
    kimiModel,
    geminiModel,
    grokModel,
    isLoading: isProcessing,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    sendByDoubleEnter,
    onSessionProcessing,
    onSessionEstablished: handleSessionEstablished,
    onComposerModesConsumed: handleComposerModesConsumed,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    scrollToBottom,
    addMessage,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
    resolvePermissionModeForProvider,
  });

  // On WebSocket reconnect, re-subscribe so missed live events replay and a
  // still-running stream re-attaches to this socket. Do NOT REST-refresh
  // while a run is in flight: JSONL lags the live stream, and merging that
  // snapshot into the pane was the "looks broken until I reload" bug.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    if (!isProcessing) {
      await sessionStore.refreshFromServer(selectedSession.id);
    }
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0,
      }],
    });
  }, [selectedProject, selectedSession, sendMessage, sessionStore, isProcessing]);

  // Detects half-open sockets (mobile sleep, network blips) that never fire
  // `onclose` and would otherwise freeze the UI mid-run.
  useConnectionWatchdog({
    isProcessing,
    isConnected,
    getLastFrameAt,
    forceReconnect,
    onWake: handleWebSocketReconnect,
  });

  useChatRealtimeHandlers({
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    refreshTokenUsage,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onWebSocketReconnect: handleWebSocketReconnect,
    sessionStore,
  });

  // Stopping the model takes two Escape presses in quick succession. A single
  // Escape only "arms" the stop and, crucially, does NOT preventDefault — so
  // that same press can still close an open image preview / popover without
  // killing the running turn. This kills the "Esc to close the image → oops,
  // the model stopped" trap.
  const escapeArmedAtRef = useRef<number | null>(null);
  const escapeHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showStopHint, setShowStopHint] = useState(false);

  const clearEscapeArm = useCallback(() => {
    escapeArmedAtRef.current = null;
    if (escapeHintTimeoutRef.current) {
      clearTimeout(escapeHintTimeoutRef.current);
      escapeHintTimeoutRef.current = null;
    }
    setShowStopHint(false);
  }, []);

  useEffect(() => {
    if (!canAbortSession) {
      // Turn ended (or cannot be aborted): drop any half-armed stop + hint.
      clearEscapeArm();
      return;
    }

    const DOUBLE_ESCAPE_WINDOW_MS = 2000;

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      const now = Date.now();
      const armedAt = escapeArmedAtRef.current;

      if (armedAt !== null && now - armedAt <= DOUBLE_ESCAPE_WINDOW_MS) {
        // Second Escape within the window → actually stop the model.
        event.preventDefault();
        clearEscapeArm();
        handleAbortSession();
        return;
      }

      // First Escape: arm the stop and show a hint. No preventDefault here.
      escapeArmedAtRef.current = now;
      setShowStopHint(true);
      if (escapeHintTimeoutRef.current) {
        clearTimeout(escapeHintTimeoutRef.current);
      }
      escapeHintTimeoutRef.current = setTimeout(() => {
        escapeArmedAtRef.current = null;
        escapeHintTimeoutRef.current = null;
        setShowStopHint(false);
      }, DOUBLE_ESCAPE_WINDOW_MS);
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, clearEscapeArm]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  // Approving the plan leaves plan mode behind and hands the agent the rights
  // to actually carry it out: the SDK gets an explicit setMode on approval (see
  // claude-sdk.js) and the chip follows it, or the NEXT message would be sent
  // read-only again — or worse, land in "ask" and stop on every step of a plan
  // the user just approved. Denying ("revise") keeps plan mode.
  const handlePermissionDecision = useCallback<PermissionContextValue['handlePermissionDecision']>(
    (requestIds, decision) => {
      if (decisionExitsPlanMode(permissionMode, pendingPermissionRequests, requestIds, decision?.allow)) {
        selectPermissionMode(permissionModeAfterPlanApproval(availablePermissionModes));
      }

      sendPermissionDecision(requestIds, decision);
    },
    [
      permissionMode,
      pendingPermissionRequests,
      availablePermissionModes,
      selectPermissionMode,
      sendPermissionDecision,
    ],
  );

  // "Plan + auto-run": the whole point of the mode is that nobody has to tap
  // anything, so the client answers the prompts itself — first the plan, then
  // whatever the approved plan needs. Answered ids are remembered because the
  // decision only removes them from `pendingPermissionRequests` on the next
  // render, and a double answer to one requestId is a protocol error.
  const autoAnsweredRequestIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const modeForAutoApprove = autoPlanRunActiveRef.current ? AUTO_PLAN_MODE : permissionMode;
    const ids = autoApprovedRequestIds(modeForAutoApprove, pendingPermissionRequests)
      .filter((requestId) => !autoAnsweredRequestIdsRef.current.has(requestId));
    if (ids.length === 0) {
      return;
    }

    ids.forEach((requestId) => autoAnsweredRequestIdsRef.current.add(requestId));
    handlePermissionDecision(ids, { allow: true });
  }, [permissionMode, pendingPermissionRequests, handlePermissionDecision]);

  const wasProcessingRef = useRef(isProcessing);
  useEffect(() => {
    const wasProcessing = wasProcessingRef.current;
    wasProcessingRef.current = isProcessing;
    if (wasProcessing && !isProcessing && pendingPermissionRequests.length === 0) {
      autoPlanRunActiveRef.current = false;
    }
  }, [isProcessing, pendingPermissionRequests]);

  useEffect(() => {
    // Ids are unique per run; a new chat starts with a clean slate so the set
    // can't grow without bound across a long-lived tab.
    autoAnsweredRequestIdsRef.current = new Set();
  }, [selectedSession?.id]);

  // Models flagged `hidden` in the catalog stay wired but out of the picker
  // (the local RTX models and the BYO gateways, 21.08.2026).
  // Cross-engine models are listed in every chat, not just empty ones — hiding
  // them inside a running chat read as "Grok disappeared". In a running chat
  // the label says where the pick lands, because it opens a new chat there.
  const { options: composerModelOptions, providerByModel: composerModelProviders } = useMemo(() => {
    const visibleModels = (target: typeof provider) => (
      selectableModels(target, providerModelCatalog[target])
        .map((option) => ({ ...option, group: COMPOSER_MODEL_GROUP_LABELS[target] }))
    );
    const hasRunningSession = Boolean(currentSessionId || selectedSession?.id);
    const providerByModel = new Map<string, typeof provider>();
    const options = visibleModels(provider);
    options.forEach((option) => providerByModel.set(option.value, provider));

    COMPOSER_CROSS_ENGINE_PROVIDERS.forEach((candidate) => {
      if (candidate === provider) {
        return;
      }
      visibleModels(candidate).forEach((option) => {
        if (providerByModel.has(option.value)) {
          return;
        }
        providerByModel.set(option.value, candidate);
        options.push(hasRunningSession
          ? {
            ...option,
            label: `${option.label} · ${t('input.inANewChat', { defaultValue: 'в новом чате' })}`,
          }
          : option);
      });
    });

    return { options, providerByModel };
  }, [providerModelCatalog, provider, currentSessionId, selectedSession?.id, t]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  // Mirrors ChatComposer's own visibility check so the message pane can
  // reserve enough bottom space to keep the floating status tab from
  // overlapping the last message.
  const hasActivityIndicator = Boolean(sessionActivity && pendingPermissionRequests.length === 0);

  if (!selectedProject) {
    const selectedProviderLabel =
      provider === 'cursor'
        ? t('messageTypes.cursor')
        : provider === 'codex'
          ? t('messageTypes.codex')
          : provider === 'opencode'
              ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
            : provider === 'kimi'
              ? t('messageTypes.kimi', { defaultValue: 'Kimi' })
              : provider === 'grok'
                ? t('messageTypes.grok', { defaultValue: 'Grok' })
                : t('messageTypes.claude');

    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
        <PinnedUserMessage scrollContainerRef={scrollContainerRef} revision={chatMessages.length} />
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          isProcessing={isProcessing}
          hasActivityIndicator={hasActivityIndicator}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          opencodeModel={opencodeModel}
          setOpenCodeModel={setOpenCodeModel}
          kimiModel={kimiModel}
          setKimiModel={setKimiModel}
          geminiModel={geminiModel}
          setGeminiModel={setGeminiModel}
          grokModel={grokModel}
          setGrokModel={setGrokModel}
          providerModelCatalog={providerModelCatalog}
          providerModelsLoading={providerModelsLoading}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={chatMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
        />
        </div>

        <div className="relative flex-shrink-0">
          {showStopHint && (
            <div className="pointer-events-none absolute -top-11 left-0 right-0 z-30 flex justify-center">
              <div className="rounded-full border border-border/50 bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                {t('input.pressEscAgainToStop', { defaultValue: 'Press Esc again to stop' })}
              </div>
            </div>
          )}
          {isUserScrolledUp && chatMessages.length > 0 && (
            <div className="pointer-events-none absolute -top-11 left-0 right-0 z-20 flex justify-center">
              <button
                type="button"
                onClick={scrollToBottomAndReset}
                aria-label={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground"
                title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
              >
                <ArrowDownIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}

          <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          activity={sessionActivity}
          isLoading={isProcessing}
          onAbortSession={handleAbortSession}
          onAppendNow={handleAppendNow}
          isAppendPending={isAppendPending}
          permissionMode={permissionMode}
          availablePermissionModes={availablePermissionModes}
          onSelectPermissionMode={selectPermissionMode}
          workMode={workMode}
          onSelectWorkMode={selectWorkMode}
          // Work modes ride on a system-prompt append (see
          // server/shared/work-mode.ts): Claude's appendSystemPrompt and Grok
          // Build's `--rules`. Runtimes without such a hook say so on the chip
          // instead of pretending to apply it — the matrix decides, so adding a
          // runtime never means touching this component.
          isWorkModeSupported={supportsWorkModeForProvider(provider)}
          model={providerModels[provider]}
          availableModelOptions={composerModelOptions}
          onSelectModel={(nextModel) => {
            // A model belonging to another engine (Grok listed under the Claude
            // models) switches the engine too. The mirror into localStorage
            // matches what the provider dialog does, so a reload starts on the
            // same engine.
            const targetProvider = composerModelProviders.get(nextModel) ?? provider;
            const isEngineSwitch = targetProvider !== provider;
            if (isEngineSwitch) {
              setProvider(targetProvider as Provider);
              localStorage.setItem('selected-provider', targetProvider);
            }
            // A session belongs to exactly one CLI, so switching engines inside
            // a running chat is not a thing: the pick opens a fresh chat on the
            // new engine (the label in the menu says so) and the model is
            // recorded as that chat's starting choice, not against the old id.
            const startsNewChat = isEngineSwitch && Boolean(currentSessionId || selectedSession?.id);
            // Scoped to this chat: selectProviderModel moves the chip and,
            // once there is a session id, records the choice on that session.
            // The starting model for NEW chats is a separate Settings value
            // and is deliberately left alone here.
            const sessionIdForOverride = startsNewChat
              ? null
              : currentSessionId || selectedSession?.id || null;
            selectProviderModel(targetProvider, nextModel, sessionIdForOverride).catch((error) => {
              console.error('Failed to persist the session model override:', error);
            });
            if (startsNewChat) {
              onStartNewChat?.();
            }
          }}
          effort={currentProviderEffort}
          availableEffortOptions={currentProviderEffortOptions}
          onSelectEffort={(nextEffort) => {
            // Session-scoped, mirroring onSelectModel above.
            const sessionIdForOverride = currentSessionId || selectedSession?.id || null;
            selectProviderEffort(provider, nextEffort, sessionIdForOverride).catch((error) => {
              console.error('Failed to persist the session effort override:', error);
            });
          }}
          tokenBudget={tokenBudget}
          onShowTokenUsage={showCostModal}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          queuedDraft={queuedDraft}
          onEditQueuedDraft={editQueuedDraft}
          onDeleteQueuedDraft={deleteQueuedDraft}
          attachedImages={attachedImages}
          onRemoveImage={(index) =>
            setAttachedImages((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openImagePicker={openImagePicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onVoiceTranscript={handleVoiceTranscript}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          isInputFocused={isInputFocused}
          onInputFocusChange={handleInputFocusChange}
          placeholder={t('input.placeholder', {
            provider:
              provider === 'cursor'
                ? t('messageTypes.cursor')
                : provider === 'codex'
                  ? t('messageTypes.codex')
                  : provider === 'opencode'
                      ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
                    : provider === 'kimi'
                      ? t('messageTypes.kimi', { defaultValue: 'Kimi' })
                      : provider === 'grok'
                        ? t('messageTypes.grok', { defaultValue: 'Grok' })
                        : t('messageTypes.claude'),
          })}
          isTextareaExpanded={isTextareaExpanded}
        />
        </div>
      </div>

      <QuickSettingsPanel />

      <CommandResultModal
        payload={commandModalPayload}
        onClose={closeCommandModal}
        providerModelCatalog={providerModelCatalog}
        providerModelCacheCatalog={providerModelCacheCatalog}
        providerModelsRefreshing={providerModelsRefreshing}
        onHardRefreshProviderModels={hardRefreshProviderModels}
        currentSessionId={currentSessionId || selectedSession?.id || null}
        onSelectProviderModel={selectProviderModel}
      />
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);

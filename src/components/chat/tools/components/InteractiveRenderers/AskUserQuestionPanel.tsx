import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Mic } from 'lucide-react';
import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';
import type { Question } from '../../../types/types';
import { useAuth } from '../../../../auth';
import { useVoiceInput } from '../../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../../hooks/useVoiceAvailable';
import VoiceInputButton from '../../../view/subcomponents/VoiceInputButton';
import { askSecretGuard } from '../../../view/subcomponents/SecretGuardDialog';
import { runSecretGuard } from '../../../utils/secretGuard';
import { stashSecretRequest } from '../../../utils/secretStash';
import { guardOwnAnswers } from '../../../utils/ownAnswers';

export const AskUserQuestionPanel: React.FC<PermissionPanelProps> = ({
  request,
  onDecision,
}) => {
  const input = request.input as { questions?: Question[] } | undefined;
  const questions: Question[] = input?.questions || [];

  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => new Map());
  const [otherActive, setOtherActive] = useState<Map<number, boolean>>(() => new Map());
  const [mounted, setMounted] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Synchronous double-submit guard: Enter + tap in the same tick both see
  // the old state, the ref does not.
  const isSubmittingRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const currentStepRef = useRef(currentStep);
  currentStepRef.current = currentStep;

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Focus the container for keyboard events when step changes
  useEffect(() => {
    if (!otherActive.get(currentStep)) {
      containerRef.current?.focus();
    }
  }, [currentStep, otherActive]);

  useEffect(() => {
    if (otherActive.get(currentStep)) {
      otherInputRef.current?.focus();
    }
  }, [otherActive, currentStep]);

  const toggleOption = useCallback((qIdx: number, label: string, multiSelect: boolean) => {
    setSelections(prev => {
      const next = new Map(prev);
      const current = new Set(next.get(qIdx) || []);
      if (multiSelect) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
        setOtherActive(p => { const n = new Map(p); n.set(qIdx, false); return n; });
      }
      next.set(qIdx, current);
      return next;
    });
  }, []);

  const toggleOther = useCallback((qIdx: number, multiSelect: boolean) => {
    setOtherActive(prev => {
      const next = new Map(prev);
      const wasActive = next.get(qIdx) || false;
      next.set(qIdx, !wasActive);
      if (!multiSelect && !wasActive) {
        setSelections(p => { const n = new Map(p); n.set(qIdx, new Set()); return n; });
      }
      return next;
    });
  }, []);

  const setOtherText = useCallback((qIdx: number, text: string) => {
    setOtherTexts(prev => { const next = new Map(prev); next.set(qIdx, text); return next; });
  }, []);

  // Dictation for «Свой ответ»: the existing voice hook, transcript appended
  // to the current question's own answer (never auto-sent from here).
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
  // The step where dictation started: the transcript lands there even if it
  // arrives later (navigation is blocked meanwhile anyway).
  const voiceStepRef = useRef(0);
  const handleOwnTranscript = useCallback((text: string) => {
    const step = voiceStepRef.current;
    setOtherTexts(prev => {
      const next = new Map(prev);
      const base = (prev.get(step) || '').trim();
      next.set(step, base ? `${base} ${text}` : text);
      return next;
    });
    setOtherActive(prev => (prev.get(step) ? prev : new Map(prev).set(step, true)));
  }, []);
  const voice = useVoiceInput(handleOwnTranscript, handleVoiceError);
  // Recording, transcribing or a failed take waiting for retry/discard: the
  // answer is not final yet, so no submit and no step change until it is.
  const voiceBusy = voice.state !== 'idle';
  const toggleVoice = useCallback(() => {
    if (voice.state === 'idle') voiceStepRef.current = currentStepRef.current;
    voice.toggle();
  }, [voice]);
  const goToStep = useCallback((step: number) => {
    if (voiceBusy) return;
    setCurrentStep(step);
  }, [voiceBusy]);

  const buildAnswers = useCallback((ownTexts: Map<number, string> = otherTexts) => {
    const answers: Record<string, string> = {};
    questions.forEach((q, idx) => {
      const selected = Array.from(selections.get(idx) || []);
      const isOther = otherActive.get(idx) || false;
      const otherText = (ownTexts.get(idx) || '').trim();
      if (isOther && otherText) selected.push(otherText);
      if (selected.length > 0) answers[q.question] = selected.join(', ');
    });
    return answers;
  }, [questions, selections, otherActive, otherTexts]);

  // Own answers are text that reaches the agent: they pass the same secret
  // guard as the composer before the decision is sent.
  const handleSubmit = useCallback(async () => {
    if (isSubmittingRef.current || voiceBusy) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const ownTexts = new Map<number, string>();
      otherTexts.forEach((text, idx) => {
        if (otherActive.get(idx) && text.trim()) ownTexts.set(idx, text);
      });
      const guarded = await guardOwnAnswers(ownTexts, (text) =>
        runSecretGuard(text, { isAdmin, ask: askSecretGuard, stash: stashSecretRequest }),
      );
      if (!guarded.ok) {
        if (guarded.error) setSubmitError(guarded.error);
        return;
      }
      onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: buildAnswers(guarded.texts) } });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [voiceBusy, otherTexts, otherActive, isAdmin, onDecision, request.requestId, input, buildAnswers]);

  // Same lock as Submit: a dictation in progress is not thrown away by «Пропустить» / Escape.
  const handleSkip = useCallback(() => {
    if (isSubmittingRef.current || voiceBusy) return;
    onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: {} } });
  }, [voiceBusy, onDecision, request.requestId, input]);

  // Keyboard handler for number keys and navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't capture keys when typing in the "Other" input
    if (e.target instanceof HTMLInputElement) return;

    const q = questions[currentStep];
    if (!q) return;
    const multi = q.multiSelect || false;
    const optCount = q.options.length;

    // Number keys 1-9 for options
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= optCount) {
      e.preventDefault();
      toggleOption(currentStep, q.options[num - 1].label, multi);
      return;
    }

    // 0 for "Other"
    if (e.key === '0') {
      e.preventDefault();
      toggleOther(currentStep, multi);
      return;
    }

    // Enter to advance / submit
    if (e.key === 'Enter') {
      e.preventDefault();
      const isLast = currentStep === questions.length - 1;
      if (isLast) void handleSubmit();
      else goToStep(currentStep + 1);
      return;
    }

    // Escape to skip
    if (e.key === 'Escape') {
      e.preventDefault();
      handleSkip();
      return;
    }
  }, [currentStep, questions, toggleOption, toggleOther, handleSubmit, handleSkip, goToStep]);

  if (questions.length === 0) return null;

  const total = questions.length;
  const isSingle = total === 1;
  const q = questions[currentStep];
  const multi = q.multiSelect || false;
  const selected = selections.get(currentStep) || new Set<string>();
  const isOtherOn = otherActive.get(currentStep) || false;
  const isLast = currentStep === total - 1;
  const isFirst = currentStep === 0;
  const hasCurrentSelection = selected.size > 0 || (isOtherOn && (otherTexts.get(currentStep) || '').trim().length > 0);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={`w-full outline-none transition-all duration-slow ease-ui ${
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      <div className="relative overflow-hidden rounded-ui-2xl border border-border bg-card shadow-2">
        {/* Accent line */}
        <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-primary via-primary/70 to-primary/85" />

        {/* Header + Question — compact */}
        <div className="px-4 pb-2 pt-3.5">
          <div className="mb-1.5 flex items-center gap-2.5">
            {/* Question icon */}
            <div className="relative flex-shrink-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-ui-lg bg-primary/10">
                <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 3h.01" />
                </svg>
              </div>
              <div className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-primary" />
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                Нужен твой ответ
              </span>
              {q.header && (
                <span className="inline-flex items-center rounded-ui-sm border border-primary/30 bg-primary/10 px-1.5 py-px text-[13px] font-semibold uppercase tracking-wider text-primary">
                  {q.header}
                </span>
              )}
            </div>

            {/* Step counter */}
            {!isSingle && (
              <span className="flex-shrink-0 text-[12px] tabular-nums text-muted-foreground">
                {currentStep + 1}/{total}
              </span>
            )}
          </div>

          {/* Progress dots (multi-question) */}
          {!isSingle && (
            <div className="mb-2 flex items-center gap-1">
              {questions.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => goToStep(i)}
                  disabled={voiceBusy}
                  className={`h-[3px] rounded-full transition-all duration-slow ease-ui ${
                    i === currentStep
                      ? 'w-5 bg-primary'
                      : i < currentStep
                        ? 'w-2.5 bg-primary/50'
                        : 'w-2.5 bg-muted'
                  }`}
                />
              ))}
            </div>
          )}

          {/* Question text */}
          <p className="text-[17px] font-medium leading-snug text-foreground">
            {q.question}
          </p>
          {multi && (
            <span className="text-[12px] text-muted-foreground">Select all that apply</span>
          )}
        </div>

        {/* Options — tight spacing */}
        <div className="scrollbar-thin max-h-48 overflow-y-auto px-4 pb-2" role={multi ? 'group' : 'radiogroup'} aria-label={q.question}>
          <div className="space-y-1">
            {/* «Свой ответ» — first: most answers are typed (or dictated), not picked */}
            <div className="flex items-stretch gap-1.5">
              <button
                type="button"
                onClick={() => toggleOther(currentStep, multi)}
                aria-pressed={isOtherOn}
                className={`group flex min-w-0 flex-1 items-center gap-2.5 rounded-ui-lg border px-3 py-2 text-left transition-all duration-fast ease-ui ${
                  isOtherOn
                    ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/25'
                    : 'border-primary/30 bg-primary/[0.04] hover:bg-primary/10'
                }`}
              >
                <kbd className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-ui-sm font-mono text-[12px] transition-all duration-fast ease-ui ${
                  isOtherOn
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : 'border border-border bg-muted text-muted-foreground'
                }`}>
                  0
                </kbd>
                <span className={`text-[15px] font-medium leading-tight transition-colors ${
                  isOtherOn ? 'text-foreground' : 'text-foreground/90'
                }`}>
                  Свой ответ
                </span>
                {isOtherOn && (
                  <svg className="ml-auto h-4 w-4 flex-shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>
              {/* Collapsed: one tap opens the field and starts dictation. */}
              {voiceAvailable && !isOtherOn && (
                <button
                  type="button"
                  onClick={() => {
                    toggleOther(currentStep, multi);
                    if (voice.state === 'idle') toggleVoice();
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Надиктовать свой ответ"
                  title="Надиктовать свой ответ"
                  className="flex w-11 flex-shrink-0 items-center justify-center rounded-ui-lg border border-primary/30 bg-primary/[0.04] text-primary transition-colors duration-fast ease-ui hover:bg-primary/10"
                >
                  <Mic className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>

            {/* Own answer field — inline, with the mic when voice is available */}
            {isOtherOn && (
              <div className="pl-[30px] pr-0.5">
                <div className="flex items-center gap-1">
                  <div className="relative min-w-0 flex-1">
                    <input
                      ref={otherInputRef}
                      type="text"
                      value={otherTexts.get(currentStep) || ''}
                      onChange={(e) => setOtherText(currentStep, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (isLast) void handleSubmit();
                          else goToStep(currentStep + 1);
                        }
                        // Prevent container keydown from firing
                        e.stopPropagation();
                      }}
                      placeholder={voiceAvailable ? 'Напиши или надиктуй…' : 'Напиши свой ответ…'}
                      aria-label="Свой ответ"
                      className="w-full rounded-ui-lg border-0 bg-secondary/50 py-1.5 pl-3 pr-3 text-[15px] text-foreground outline-none ring-1 ring-border transition-shadow duration-base ease-ui placeholder:text-muted-foreground focus:ring-2 focus:ring-ring sm:pr-14"
                    />
                    <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-ui-sm border border-border bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground/70 sm:block">
                      Enter
                    </kbd>
                  </div>
                  {voiceAvailable && (
                    <span onKeyDown={(e) => e.stopPropagation()}>
                      <VoiceInputButton
                        state={voice.state}
                        onToggle={toggleVoice}
                        errorMsg={voiceError}
                        onDiscard={voice.discard}
                        getLevel={voice.getLevel}
                        getElapsedMs={voice.getElapsedMs}
                      />
                    </span>
                  )}
                </div>
              </div>
            )}

            {q.options.map((opt, optIdx) => {
              const isSelected = selected.has(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => toggleOption(currentStep, opt.label, multi)}
                  className={`group flex w-full items-center gap-2.5 rounded-ui-lg border px-3 py-2 text-left transition-all duration-fast ease-ui ${
                    isSelected
                      ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/25'
                      : 'border-border hover:bg-secondary/60'
                  }`}
                >
                  {/* Keyboard hint */}
                  <kbd className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-ui-sm font-mono text-[12px] transition-all duration-fast ease-ui ${
                    isSelected
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'border border-border bg-muted text-muted-foreground'
                  }`}>
                    {optIdx + 1}
                  </kbd>

                  <div className="min-w-0 flex-1">
                    <div className={`text-[15px] leading-tight transition-colors duration-fast ease-ui ${
                      isSelected
                        ? 'font-medium text-foreground'
                        : 'text-foreground/80'
                    }`}>
                      {opt.label}
                    </div>
                    {opt.description && (
                      <div className={`text-[13px] leading-snug transition-colors duration-fast ease-ui ${
                        isSelected
                          ? 'text-primary/80'
                          : 'text-muted-foreground'
                      }`}>
                        {opt.description}
                      </div>
                    )}
                  </div>

                  {/* Selection check */}
                  {isSelected && (
                    <svg className="h-4 w-4 flex-shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              );
            })}

          </div>
        </div>

        {submitError && (
          <p role="alert" className="px-4 pb-2 text-[13px] text-destructive">{submitError}</p>
        )}

        {/* Footer — compact */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-secondary/30 px-4 py-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={voiceBusy}
            className="text-[13px] text-muted-foreground transition-colors duration-fast ease-ui hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            {isSingle ? 'Пропустить' : 'Пропустить все'}
            <span className="ml-1 text-[11px] text-muted-foreground/70">Esc</span>
          </button>

          <div className="flex items-center gap-1.5">
            {!isSingle && !isFirst && (
              <button
                type="button"
                onClick={() => goToStep(currentStep - 1)}
                disabled={voiceBusy}
                className="inline-flex items-center gap-0.5 rounded-ui-lg px-2.5 py-1.5 text-[13px] font-medium text-foreground/80 transition-all duration-fast ease-ui hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}

            {isLast ? (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting || voiceBusy || (!hasCurrentSelection && !Object.keys(buildAnswers()).length)}
                className="inline-flex items-center gap-1 rounded-ui-lg bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground shadow-1 transition-all duration-base ease-ui hover:shadow-2 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
              >
                Отправить
                <span className="ml-0.5 font-mono text-[11px] opacity-70">Enter</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goToStep(currentStep + 1)}
                disabled={voiceBusy}
                className="inline-flex items-center gap-1 rounded-ui-lg bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground shadow-1 transition-all duration-base ease-ui hover:shadow-2 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Next
                <span className="ml-0.5 font-mono text-[11px] opacity-70">Enter</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

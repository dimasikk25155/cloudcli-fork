import { useTranslation } from 'react-i18next';
import { Mic, Square, Loader2, RotateCw, X, Download } from 'lucide-react';

import { PromptInputButton } from '../../../../shared/view/ui';
import type { VoiceInputState } from '../../hooks/useVoiceInput';

import VoiceWaveform from './VoiceWaveform';

type Props = {
  state: VoiceInputState;
  onToggle: () => void;
  errorMsg?: string | null;
  recoveryMessage?: string | null;
  /** Drop a recording that failed to transcribe (only shown in the error state). */
  onDiscard?: () => void;
  onDownload?: () => void;
  /** Live mic level, 0..1 — drives the waveform while recording. */
  getLevel?: () => number;
  /** Milliseconds since recording started. */
  getElapsedMs?: () => number;
};

// Push-to-talk mic button (presentational). Recording state and the stop-and-send action
// are owned by the composer so the main Send button can drive them too. This button just
// starts recording and, while recording, stops and drops the transcript into the input box.
export default function VoiceInputButton({
  state,
  onToggle,
  errorMsg,
  recoveryMessage,
  onDiscard,
  onDownload,
  getLevel,
  getElapsedMs,
}: Props) {
  const { t } = useTranslation('chat');

  const icon =
    state === 'recording' ? (
      // Filled, not outlined: a hollow square reads as an empty checkbox.
      <Square className="fill-red-500 text-red-500" />
    ) : state === 'transcribing' || state === 'restoring' ? (
      <Loader2 className="animate-spin" />
    ) : state === 'error' ? (
      <RotateCw />
    ) : (
      <Mic />
    );

  const failed = state === 'error';

  return (
    <span className="relative inline-flex items-center gap-1">
      {(errorMsg || recoveryMessage) && (
        <span role="status" className="absolute bottom-full right-0 mb-1 w-72 max-w-[70vw] whitespace-normal rounded bg-muted px-3 py-2 text-xs text-foreground shadow-lg">
          {errorMsg && <span className="block text-destructive">{errorMsg}</span>}
          {recoveryMessage && <span className="block">{recoveryMessage}</span>}
        </span>
      )}
      {state === 'recording' && getLevel && getElapsedMs && (
        <VoiceWaveform getLevel={getLevel} getElapsedMs={getElapsedMs} />
      )}
      <PromptInputButton
        tooltip={{
          content: failed
            ? t('voice.retry')
            : state === 'recording'
              ? t('voice.stopRecording')
              : t('voice.input'),
        }}
        disabled={state === 'restoring' || state === 'transcribing'}
        className={failed ? 'text-amber-500' : undefined}
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          onToggle();
        }}
      >
        {icon}
      </PromptInputButton>
      {(failed || state === 'transcribing') && onDownload && (
        <PromptInputButton
          tooltip={{ content: t('voice.download', { defaultValue: 'Скачать запись' }) }}
          aria-label={t('voice.download', { defaultValue: 'Скачать запись' })}
          onClick={(event: { preventDefault: () => void }) => { event.preventDefault(); onDownload(); }}
        >
          <Download />
        </PromptInputButton>
      )}
      {/* The failed recording is still in memory: offer an explicit way to drop it. */}
      {failed && onDiscard && (
        <PromptInputButton
          tooltip={{ content: t('voice.discard') }}
          onClick={(e: { preventDefault: () => void }) => {
            e.preventDefault();
            onDiscard();
          }}
        >
          <X />
        </PromptInputButton>
      )}
    </span>
  );
}

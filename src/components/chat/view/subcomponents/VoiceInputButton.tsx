import { useTranslation } from 'react-i18next';
import { Mic, Square, Loader2, RotateCw, X } from 'lucide-react';

import { PromptInputButton } from '../../../../shared/view/ui';
import type { VoiceInputState } from '../../hooks/useVoiceInput';

type Props = {
  state: VoiceInputState;
  onToggle: () => void;
  errorMsg?: string | null;
  /** Drop a recording that failed to transcribe (only shown in the error state). */
  onDiscard?: () => void;
};

// Push-to-talk mic button (presentational). Recording state and the stop-and-send action
// are owned by the composer so the main Send button can drive them too. This button just
// starts recording and, while recording, stops and drops the transcript into the input box.
export default function VoiceInputButton({ state, onToggle, errorMsg, onDiscard }: Props) {
  const { t } = useTranslation('chat');

  const icon =
    state === 'recording' ? (
      <Square className="text-red-500" />
    ) : state === 'transcribing' ? (
      <Loader2 className="animate-spin" />
    ) : state === 'error' ? (
      <RotateCw />
    ) : (
      <Mic />
    );

  const failed = state === 'error';

  return (
    <span className="relative inline-flex items-center gap-1">
      {errorMsg && (
        <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 max-w-[70vw] truncate rounded bg-red-600 px-2 py-1 text-xs text-white shadow-lg">
          {failed ? t('voice.retryHint', { error: errorMsg }) : errorMsg}
        </span>
      )}
      <PromptInputButton
        tooltip={{
          content: failed
            ? t('voice.retry')
            : state === 'recording'
              ? t('voice.stopRecording')
              : t('voice.input'),
        }}
        className={failed ? 'text-amber-500' : undefined}
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          onToggle();
        }}
      >
        {icon}
      </PromptInputButton>
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

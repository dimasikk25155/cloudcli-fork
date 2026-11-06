export type ComposerSubmitAction = 'voice-send' | 'queue' | 'abort' | 'submit';

/**
 * What the composer's main button does. Dictation outranks "stop the agent":
 * a tap while recording ends the take and sends it (queued if the agent is
 * busy). Checking the run first used to abort it and leave the mic recording.
 */
export function composerSubmitAction(state: {
  isRecording: boolean;
  canQueueDraft: boolean;
  isLoading: boolean;
}): ComposerSubmitAction {
  if (state.isRecording) return 'voice-send';
  if (state.canQueueDraft) return 'queue';
  if (state.isLoading) return 'abort';
  return 'submit';
}

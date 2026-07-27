import { useCallback, useEffect, useRef, useState } from 'react';

import { transcribeVoice } from '../../../lib/voiceApi';
import { toWav16kMono } from '../utils/audioToWav';

// Mobile-safe recording: iOS Safari 18.4+ supports webm/opus; older iOS needs mp4.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickMime(): string {
  for (const t of MIME_CANDIDATES) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on some iOS versions */
    }
  }
  return '';
}

export type VoiceInputState = 'idle' | 'recording' | 'transcribing' | 'error';

// Mobile networks blip and free API tiers rate-limit, so a first failure means
// little. Retry a couple of times before bothering the user.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [600, 1800];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PendingRecording = { blob: Blob; filename: string; send: boolean };

/** Pull the server's own explanation out of a failed response. */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.clone().json();
    const message = (data as { error?: unknown })?.error;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    /* not JSON — fall through */
  }
  return `HTTP ${res.status}`;
}

/** Retrying will not fix a rejected request (bad key, bad audio). */
function isPermanent(status: number): boolean {
  return status < 500 && status !== 408 && status !== 429;
}

/**
 * Push-to-talk dictation. Records the mic, uploads to /api/voice/transcribe
 * (an OpenAI-compatible speech-to-text backend via the Express proxy), and
 * returns the transcript through onTranscript.
 */
export function useVoiceInput(
  onTranscript: (text: string, send?: boolean) => void,
  onError?: (msg: string) => void,
) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  // Audio that failed to transcribe, kept so a retry never loses the dictation.
  const pendingRef = useRef<PendingRecording | null>(null);
  // Whether the in-progress stop should auto-send the transcript (vs just fill the box).
  const sendRef = useRef(false);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      startingRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  // Upload with retries. On give-up the recording is kept in pendingRef and the
  // hook enters 'error', so the user can retry the same audio instead of
  // re-recording it.
  const runTranscription = useCallback(
    async (pending: PendingRecording) => {
      setState('transcribing');
      let lastError = '';

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelledRef.current) return;
        try {
          const res = await transcribeVoice(pending.blob, pending.filename);
          if (res.ok) {
            const data = await res.json();
            if (cancelledRef.current) return;
            pendingRef.current = null;
            const text = String(data?.text || '').trim();
            setState('idle');
            if (text) onTranscript(text, pending.send);
            else onError?.('No speech detected');
            return;
          }
          lastError = await readErrorMessage(res);
          if (isPermanent(res.status)) break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
        if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_DELAYS_MS[attempt]);
      }

      if (cancelledRef.current) return;
      pendingRef.current = pending;
      setState('error');
      onError?.(lastError);
    },
    [onTranscript, onError],
  );

  const start = useCallback(async () => {
    if (startingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
    startingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        stopTracks();
        if (cancelledRef.current) return;
        // Capture and clear the send intent for this stop before any async work.
        const shouldSend = sendRef.current;
        sendRef.current = false;
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 800) {
          setState('idle');
          onError?.('Recording too short');
          return;
        }
        setState('transcribing');
        // Re-encode to WAV so the backend reads a correct duration (see
        // audioToWav). Falls back to the raw recording if decoding fails.
        const wav = await toWav16kMono(blob);
        if (cancelledRef.current) return;
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        await runTranscription(
          wav
            ? { blob: wav, filename: 'recording.wav', send: shouldSend }
            : { blob, filename: `recording.${ext}`, send: shouldSend },
        );
      };

      rec.start();
      setState('recording');
    } catch (e) {
      recorderRef.current = null;
      stopTracks();
      if (cancelledRef.current) return;
      const err = e as { name?: string; message?: string };
      let msg = `Mic error: ${err?.message || e}`;
      if (err?.name === 'NotAllowedError') msg = 'Microphone access denied.';
      else if (err?.name === 'NotFoundError') msg = 'No microphone found.';
      onError?.(msg);
      setState('idle');
    } finally {
      startingRef.current = false;
    }
  }, [onError, runTranscription]);

  // Stop recording. Pass { send: true } to auto-send the transcript once it's ready.
  // Guard on the recorder's own state (not React state) so a double tap, or the mic
  // and Send buttons both firing, can't call stop() on an already-inactive recorder.
  const stop = useCallback((opts?: { send?: boolean }) => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      sendRef.current = opts?.send ?? false;
      rec.stop();
    }
  }, []);

  // Re-upload the kept recording.
  const retry = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) void runTranscription(pending);
  }, [runTranscription]);

  // Throw the failed recording away and go back to a clean mic.
  const discard = useCallback(() => {
    pendingRef.current = null;
    setState('idle');
  }, []);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'error') retry();
    else if (state === 'idle') start();
  }, [state, start, stop, retry]);

  return { state, toggle, stop, retry, discard };
}

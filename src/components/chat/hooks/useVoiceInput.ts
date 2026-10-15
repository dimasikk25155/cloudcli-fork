import { useCallback, useEffect, useRef, useState } from 'react';

import { listVoiceRecordings, removeVoiceRecording, saveVoiceRecording, type SavedVoiceRecording } from '../../../lib/voiceRecovery';
import { transcribeVoice } from '../../../lib/voiceApi';
import { splitWav } from '../../../../shared/voiceAudio.js';
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

export type VoiceInputState = 'idle' | 'restoring' | 'recording' | 'transcribing' | 'error';

/** Live loudness tap on the recording stream — feeds the waveform, nothing else. */
type Meter = {
  ctx: AudioContext;
  analyser: AnalyserNode;
  buf: Uint8Array<ArrayBuffer>;
  /** Cloned track the meter listens to; stopped together with the context. */
  track: MediaStreamTrack | null;
} | null;

// Metering is decoration: a browser without AudioContext (or one that refuses
// to open it) must still record normally, so every failure returns null.
function openMeter(stream: MediaStream): Meter {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    void ctx.resume(); // iOS hands back a suspended context
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    // Listen to a CLONE of the track, never the one MediaRecorder is writing:
    // on iOS, wiring a live capture track into an AudioContext can flip the
    // audio session into voice-processing mode and wreck the recording.
    const source = stream.getAudioTracks()[0];
    const track = source ? source.clone() : null;
    ctx.createMediaStreamSource(track ? new MediaStream([track]) : stream).connect(analyser);
    return { ctx, analyser, buf: new Uint8Array(analyser.fftSize), track };
  } catch {
    return null;
  }
}

function closeMeter(meter: Meter) {
  if (!meter) return;
  meter.track?.stop();
  void meter.ctx.close().catch(() => {});
}

// Mobile networks blip and free API tiers rate-limit, so a first failure means
// little. Retry a couple of times before bothering the user.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [600, 1800];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PendingRecording = SavedVoiceRecording & { send: boolean };

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
  onError: ((msg: string) => void) | undefined,
  recoveryScope: string,
) {
  const [state, setState] = useState<VoiceInputState>('restoring');
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const busyRef = useRef(true);
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const recordingInfoRef = useRef<{ id: string; createdAt: number } | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // Live mic metering for the waveform. Kept in refs, not state: the meter is
  // read ~20 times a second and must never re-render the composer.
  const meterRef = useRef<Meter>(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  // Audio that failed to transcribe, kept so a retry never loses the dictation.
  const pendingRef = useRef<PendingRecording | null>(null);
  // Whether the in-progress stop should auto-send the transcript (vs just fill the box).
  const sendRef = useRef(false);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    closeMeter(meterRef.current);
    meterRef.current = null;
    startedAtRef.current = 0;
  };

  const persist = useCallback((recording: SavedVoiceRecording): Promise<boolean> => {
    const saved = writeQueueRef.current.then(() => saveVoiceRecording(recording)).then(() => true, () => {
      if (!cancelledRef.current) setRecoveryMessage('Автосохранение недоступно. Не закрывай страницу — скачай запись после остановки.');
      return false;
    });
    writeQueueRef.current = saved;
    return saved;
  }, []);

  const restoreNext = useCallback(async () => {
    const saved = (await listVoiceRecordings(recoveryScope))[0];
    if (cancelledRef.current) return;
    pendingRef.current = saved ? { ...saved, send: false } : null;
    busyRef.current = false;
    setState(saved ? 'error' : 'idle');
    setRecoveryMessage(saved ? (saved.status === 'recording'
      ? 'Восстановлена прерванная запись. Проверь скачанный файл: последнее мгновение могло не сохраниться.'
      : saved.transcript ? 'Расшифровка восстановлена. Нажми повтор — текст вставится без обращения к сети.'
        : 'Запись восстановлена с устройства. Можно сменить VPN и нажать повтор или скачать аудио.') : null);
  }, [recoveryScope]);

  useEffect(() => {
    let disposed = false;
    cancelledRef.current = false;
    void listVoiceRecordings(recoveryScope).then((saved) => {
      if (disposed) return;
      const recording = saved[0];
      pendingRef.current = recording ? { ...recording, send: false } : null;
      busyRef.current = false;
      setState(recording ? 'error' : 'idle');
      if (recording) setRecoveryMessage(recording.status === 'recording'
        ? 'Восстановлена прерванная запись. Проверь файл перед отправкой.'
        : recording.transcript ? 'Расшифровка восстановлена. Нажми повтор для вставки без сети.'
          : 'Запись восстановлена с устройства. Сменить VPN можно без повторной диктовки.');
    }).catch(() => {
      if (disposed) return;
      busyRef.current = false;
      setState('idle');
      setRecoveryMessage('Хранилище записей недоступно. При ошибке скачай аудио до закрытия страницы.');
    });
    return () => {
      disposed = true;
      cancelledRef.current = true;
      startingRef.current = false;
      // onstop still persists the final blob, but may not send it into another chat.
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      closeMeter(meterRef.current);
      meterRef.current = null;
    };
  }, [recoveryScope]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (recorderRef.current?.state !== 'recording' && !busyRef.current && !pendingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  /** Current mic loudness, 0..1, ready to drive a bar height. */
  const getLevel = useCallback(() => {
    const meter = meterRef.current;
    if (!meter) return 0;
    const { analyser, buf } = meter;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    // Speech RMS lives around 0.03..0.2, so scale it up before clamping —
    // otherwise normal talking barely lifts the bars off the floor.
    return Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length) * 3.2));
  }, []);

  /** Milliseconds since recording started (0 when not recording). */
  const getElapsedMs = useCallback(
    () => (startedAtRef.current ? Date.now() - startedAtRef.current : 0),
    [],
  );

  // Upload with retries. On give-up the recording is kept in pendingRef and the
  // hook enters 'error', so the user can retry the same audio instead of
  // re-recording it.
  const runTranscription = useCallback(
    async (pending: PendingRecording) => {
      if (busyRef.current || cancelledRef.current) return;
      busyRef.current = true;
      pendingRef.current = pending;
      setState('transcribing');
      onError?.('');
      if (await persist(pending)) setRecoveryMessage('Оригинал сохранён на устройстве. Если VPN мешает, запись можно повторить или скачать.');
      let lastError = '';

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelledRef.current) return;
        try {
          let text = pending.transcript || '';
          let suspect = false;
          if (!text) {
            const wav = await toWav16kMono(pending.blob);
            if (!wav) throw new Error('Не удалось прочитать запись целиком. Аудио сохранено — скачай его или повтори распознавание.');
            const audio = splitWav(new Uint8Array(await wav.arrayBuffer()));
            const recordedSeconds = pending.recordedMs / 1000;
            if (!audio || (recordedSeconds > 10 && audio.duration < recordedSeconds - Math.max(2, recordedSeconds * 0.1))) {
              throw new Error('Длительность аудио меньше времени записи. Аудио сохранено — проверь файл перед отправкой.');
            }
            const res = await transcribeVoice(wav, 'recording.wav', { thorough: Boolean(pending.thorough) });
            if (!res.ok) {
              lastError = await readErrorMessage(res);
              if (isPermanent(res.status)) break;
              throw new Error(lastError);
            }
            const data = await res.json();
            text = String(data?.text || '').trim();
            suspect = data?.suspect === true;
          }
          if (cancelledRef.current) return;
          if (!text) {
            lastError = 'Речь не распознана. Запись сохранена — повтори распознавание.';
            break;
          }
          if (suspect) {
            // The server found far fewer words than speech: insert what was
            // heard, but keep the original so nothing has to be re-dictated.
            onTranscript(text, false);
            pending = { ...pending, transcript: undefined, status: 'pending', send: false, thorough: true };
            pendingRef.current = pending;
            await persist(pending);
            if (cancelledRef.current) return;
            busyRef.current = false;
            setState('error');
            setRecoveryMessage('Похоже, часть речи не расслышана — вставил то, что разобрал. Запись сохранена: повтор распознает её тщательнее (текст добавится ещё раз), её можно скачать или убрать.');
            return;
          }
          pending = { ...pending, transcript: text, status: 'ready' };
          pendingRef.current = pending;
          await persist(pending);
          if (cancelledRef.current) return;
          // Restore/retry always fills the composer; it must not auto-send later.
          onTranscript(text, pending.send);
          await writeQueueRef.current;
          try {
            await removeVoiceRecording(pending.id);
            await restoreNext();
          } catch {
            pendingRef.current = null;
            busyRef.current = false;
            setState('idle');
            setRecoveryMessage('Текст вставлен. Не удалось удалить резервную запись — после перезагрузки она может появиться снова.');
          }
          return;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
        if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_DELAYS_MS[attempt]);
      }

      if (cancelledRef.current) return;
      pendingRef.current = { ...pending, send: false };
      busyRef.current = false;
      setState('error');
      onError?.(lastError);
    },
    [onTranscript, onError, persist, restoreNext],
  );

  const start = useCallback(async () => {
    if (busyRef.current || pendingRef.current || startingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
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
      meterRef.current = openMeter(stream);
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      recordingInfoRef.current = { id: crypto.randomUUID(), createdAt: Date.now() };

      rec.ondataavailable = (e) => {
        if (e.data.size <= 0) return;
        chunksRef.current.push(e.data);
        const type = rec.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        void persist({ ...recordingInfoRef.current!, scope: recoveryScope,
          blob: new Blob(chunksRef.current, { type }), filename: `recording.${ext}`,
          recordedMs: Date.now() - startedAtRef.current, status: 'recording' });
      };

      rec.onstop = async () => {
        const recordedMs = Date.now() - startedAtRef.current;
        stopTracks();
        // Capture and clear the send intent for this stop before any async work.
        const shouldSend = sendRef.current;
        sendRef.current = false;
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const pending: PendingRecording = { ...recordingInfoRef.current!, scope: recoveryScope,
          blob, filename: `recording.${ext}`, send: shouldSend, recordedMs, status: 'pending' };
        // Commit the original before any decoding/network work, even on navigation.
        await persist(pending);
        if (cancelledRef.current) return;
        await runTranscription(pending);
      };

      rec.start(1000);
      startedAtRef.current = Date.now();
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
  }, [onError, runTranscription, persist, recoveryScope]);

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
    if (pending) void runTranscription({ ...pending, send: false });
  }, [runTranscription]);

  const download = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const url = URL.createObjectURL(pending.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = pending.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // Throw the failed recording away and go back to a clean mic.
  const discard = useCallback(async () => {
    if (busyRef.current) return;
    const pending = pendingRef.current;
    if (!pending) return;
    busyRef.current = true;
    try {
      await writeQueueRef.current;
      await removeVoiceRecording(pending.id);
      await restoreNext();
    } catch {
      busyRef.current = false;
      onErrorRef.current?.('Не удалось удалить запись с устройства. Попробуй ещё раз.');
    }
  }, [restoreNext]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'error') retry();
    else if (state === 'idle') start();
  }, [state, start, stop, retry]);

  return { state, recoveryMessage, toggle, stop, retry, discard, download, getLevel, getElapsedMs };
}

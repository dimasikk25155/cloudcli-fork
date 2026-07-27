// MediaRecorder writes WebM/MP4 without a reliable duration header (it is a live
// stream, so the length is unknown up front). Some speech backends then read a
// bogus length and reject the upload — Groq answers 413 "Request too large ... on
// seconds of audio per hour" for a ten-second clip.
//
// Re-encoding to 16 kHz mono WAV fixes that: the header states the exact sample
// count, and 16 kHz mono is what speech models downsample to anyway.

const TARGET_SAMPLE_RATE = 16000;

/** Wrap PCM samples in a canonical 16-bit mono WAV container. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Decode a recorded blob and re-encode it as 16 kHz mono WAV.
 * Returns null when the browser cannot decode it, so callers fall back to
 * uploading the original recording rather than losing it.
 */
export async function toWav16kMono(blob: Blob): Promise<Blob | null> {
  try {
    const AudioCtx: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const OfflineCtx: typeof OfflineAudioContext | undefined =
      window.OfflineAudioContext ||
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!AudioCtx || !OfflineCtx) return null;

    const arrayBuffer = await blob.arrayBuffer();
    const decodeCtx = new AudioCtx();
    let decoded: AudioBuffer;
    try {
      decoded = await decodeCtx.decodeAudioData(arrayBuffer);
    } finally {
      void decodeCtx.close();
    }
    if (!decoded.duration) return null;

    // Rendering through an offline context downmixes to mono and resamples.
    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
    const offline = new OfflineCtx(1, frames, TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();

    return encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
  } catch {
    return null;
  }
}

// Canonical browser recorder format: PCM16 mono WAV. Every sample is covered;
// 0.6s overlap protects words crossing a boundary when there is no quiet pause.
export function splitWav(input, maxSeconds = 60) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let rate = 0;
  let pcm;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > bytes.length) throw new Error('Неполный WAV: запись сохранена, повтори распознавание.');
    if (tag(at) === 'fmt ') {
      if (size < 16 || view.getUint16(at + 8, true) !== 1 || view.getUint16(at + 10, true) !== 1 || view.getUint16(at + 22, true) !== 16) return null;
      rate = view.getUint32(at + 12, true);
    }
    if (tag(at) === 'data') pcm = bytes.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  if (!rate || !pcm || pcm.length % 2) throw new Error('Некорректный WAV.');
  if (!Number.isFinite(maxSeconds) || maxSeconds < 2) throw new Error('Invalid audio chunk duration');
  const frames = pcm.length / 2;
  const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const step = Math.floor(maxSeconds * rate);
  const window = Math.max(1, Math.floor(rate * 0.1));
  const overlap = Math.floor(rate * 0.6);
  const chunks = [];
  for (let start = 0; start < frames;) {
    let end = Math.min(start + step, frames);
    if (end < frames) {
      let quietest = Infinity;
      let boundary = end;
      for (let pos = end; pos > Math.max(start + rate, end - 5 * rate); pos -= window) {
        let energy = 0;
        for (let frame = Math.max(start, pos - window); frame < pos; frame++) energy += samples.getInt16(frame * 2, true) ** 2;
        if (energy < quietest) { quietest = energy; boundary = pos; }
        if (energy / window < 150 ** 2) break;
      }
      end = boundary;
    }
    const audio = new Uint8Array(44 + (end - start) * 2);
    const out = new DataView(audio.buffer);
    const write = (at, text) => [...text].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
    write(0, 'RIFF'); out.setUint32(4, audio.length - 8, true); write(8, 'WAVE');
    write(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
    out.setUint16(22, 1, true); out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true);
    out.setUint16(32, 2, true); out.setUint16(34, 16, true); write(36, 'data');
    out.setUint32(40, audio.length - 44, true); audio.set(pcm.subarray(start * 2, end * 2), 44);
    chunks.push({ audio, start: start / rate, end: end / rate, silent: !audio.subarray(44).some(Boolean) });
    if (end === frames) break;
    start = end - overlap;
  }
  return { chunks, duration: frames / rate };
}

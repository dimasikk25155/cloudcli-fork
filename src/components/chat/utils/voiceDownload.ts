// Saving a failed dictation so it is not lost.
//
// MediaRecorder on iOS 18.4+ (and Chrome) writes WebM/Opus. iOS treats a .webm
// as "video": Photos refuses it, Files cannot play it, and in the home-screen
// app a blob link opens a dead preview page. So the saved copy is re-encoded to
// WAV (plays everywhere, including QuickTime on the Mac) and, on iPhone/iPad,
// handed to the system share sheet, which has «Сохранить в Файлы».

export type VoiceFileEnv = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

/** iPhone, iPod, or an iPad that reports itself as a Mac. */
export function isAppleMobile(env: VoiceFileEnv): boolean {
  if (/iPad|iPhone|iPod/.test(env.userAgent)) return true;
  return env.platform === 'MacIntel' && env.maxTouchPoints > 1;
}

/** WebM/Ogg do not play on Apple devices and are worth a WAV copy. */
export function needsPortableCopy(mimeType: string): boolean {
  return /webm|ogg/i.test(mimeType);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `golos-2026-11-23-0314.wav`: sortable, readable in Files, no spaces. */
export function voiceFileName(createdAt: number, ext: string): string {
  const d = new Date(createdAt);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `golos-${stamp}.${ext}`;
}

function extFromName(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? match[1].toLowerCase() : 'webm';
}

/**
 * The file the user gets: a WAV copy when the original will not play on Apple
 * devices, otherwise the original. A recording the browser cannot decode (an
 * interrupted one, for example) is still handed out as is — never lost.
 */
export async function prepareVoiceFile(
  recording: { blob: Blob; filename: string; createdAt: number },
  toWav: (blob: Blob) => Promise<Blob | null>,
): Promise<File> {
  const type = recording.blob.type || 'audio/webm';
  if (needsPortableCopy(type)) {
    const wav = await toWav(recording.blob).catch(() => null);
    if (wav && wav.size > 44) {
      return new File([wav], voiceFileName(recording.createdAt, 'wav'), { type: 'audio/wav' });
    }
  }
  return new File([recording.blob], voiceFileName(recording.createdAt, extFromName(recording.filename)), { type });
}

export type VoiceDeliveryDeps = {
  env: VoiceFileEnv;
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
  /** Classic `<a download>` save — desktop, Android, and the fallback. */
  saveByLink: (file: File) => void;
};

export type VoiceDeliveryResult = 'shared' | 'cancelled' | 'link';

/**
 * Hand the file over. iPhone/iPad get the share sheet: `<a download>` with a
 * blob there either opens a preview page or does nothing in the home-screen
 * app. A cancelled sheet is a decision, not an error. Any other refusal (for
 * example, the tap's user activation expired while the copy was encoding)
 * falls back to the link.
 */
export async function deliverVoiceFile(file: File, deps: VoiceDeliveryDeps): Promise<VoiceDeliveryResult> {
  const payload = { files: [file] };
  let canShare = false;
  try {
    canShare = isAppleMobile(deps.env) && Boolean(deps.share) && Boolean(deps.canShare?.(payload));
  } catch {
    canShare = false;
  }
  if (canShare) {
    try {
      await deps.share!(payload);
      return 'shared';
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') return 'cancelled';
    }
  }
  deps.saveByLink(file);
  return 'link';
}

/** Browser wiring for {@link deliverVoiceFile}. */
export function browserVoiceDeliveryDeps(): VoiceDeliveryDeps {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    env: {
      userAgent: nav?.userAgent ?? '',
      platform: nav?.platform ?? '',
      maxTouchPoints: nav?.maxTouchPoints ?? 0,
    },
    canShare: nav?.canShare ? (data) => nav.canShare(data) : undefined,
    share: nav?.share ? (data) => nav.share(data) : undefined,
    saveByLink: (file) => {
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}

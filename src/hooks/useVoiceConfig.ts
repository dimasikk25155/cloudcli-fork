import { useState } from 'react';

export type VoiceConfig = {
  baseUrl: string;
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
  // Text cleanup (server-side, proxy path only): punctuation, glossary term
  // fixes and filler removal applied to the raw transcript before it lands in
  // the input box.
  correctionEnabled: boolean;
  fillerCleanup: boolean;
  correctionModel: string;
  language: string;
  // Glossary as free text, one term per line: "Canon: variant1, variant2".
  dictionary: string;
};

const STORAGE_KEY = 'voiceConfig';
export const VOICE_CONFIG_SYNC_EVENT = 'voice-config:sync';
const DEFAULTS: VoiceConfig = {
  baseUrl: '',
  apiKey: '',
  sttModel: '',
  ttsModel: '',
  ttsVoice: '',
  ttsFormat: '',
  correctionEnabled: true,
  fillerCleanup: true,
  correctionModel: '',
  language: '',
  dictionary: '',
};

export function readVoiceConfig(): VoiceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULTS };
    const config = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof VoiceConfig)[]) {
      // Copy a stored value only when it matches the field's declared type, so a
      // malformed blob can't turn a boolean toggle into a string (or vice versa).
      if (typeof parsed[key] === typeof DEFAULTS[key]) {
        (config[key] as VoiceConfig[typeof key]) = parsed[key];
      }
    }
    return config;
  } catch {
    return { ...DEFAULTS };
  }
}

// Headers the voice proxy reads to target a per-user OpenAI-compatible backend.
// Empty fields are omitted so the server's env defaults apply.
export function voiceConfigHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const c = readVoiceConfig();
  const h: Record<string, string> = {};
  if (c.apiKey) h['x-voice-api-key'] = c.apiKey;
  if (c.sttModel) h['x-voice-stt-model'] = c.sttModel;
  if (c.ttsModel) h['x-voice-tts-model'] = c.ttsModel;
  if (c.ttsVoice) h['x-voice-tts-voice'] = c.ttsVoice;
  if (c.ttsFormat.trim()) h['x-voice-tts-format'] = c.ttsFormat.trim();
  return h;
}

/**
 * Parse the free-text glossary into a { canon: [wrong, …] } map. Each non-empty,
 * non-comment line is "Canon: variant1, variant2" (":" or "=" separator). A line
 * with no separator is a canon term with no known misspellings (still biases STT
 * and tells the corrector the canonical spelling).
 */
export function parseDictionary(blob: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of String(blob || '').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const m = s.match(/^(.+?)\s*[:=]\s*(.*)$/);
    if (m) {
      const canon = m[1].trim();
      if (!canon) continue;
      out[canon] = m[2].split(',').map((w) => w.trim()).filter(Boolean);
    } else {
      out[s] = [];
    }
  }
  return out;
}

// Cleanup options sent to the /api/voice/transcribe proxy as the 'options' field.
export type VoiceCleanupOptions = {
  correction: boolean;
  fillerCleanup: boolean;
  correctionModel: string;
  language: string;
  dictionary: Record<string, string[]>;
};

export function voiceCleanupOptions(): VoiceCleanupOptions {
  const c = readVoiceConfig();
  return {
    correction: c.correctionEnabled === true,
    fillerCleanup: c.fillerCleanup !== false,
    correctionModel: c.correctionModel.trim(),
    language: c.language.trim(),
    dictionary: parseDictionary(c.dictionary),
  };
}

export function useVoiceConfig() {
  const [config, setConfig] = useState<VoiceConfig>(() =>
    typeof window === 'undefined' ? { ...DEFAULTS } : readVoiceConfig(),
  );

  const update = (patch: Partial<VoiceConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        const stored: Partial<VoiceConfig> = { ...next };
        if (next.ttsFormat.trim()) stored.ttsFormat = next.ttsFormat.trim();
        else delete stored.ttsFormat;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
      } catch {
        /* ignore persistence errors */
      }
      return next;
    });
  };

  return { config, update };
}

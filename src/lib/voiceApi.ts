import { splitWav } from '../../shared/voiceAudio.js';
import { cleanTranscript, glossaryPrompt, joinTranscripts, correctionPreservesContent, buildCorrectionSystemPrompt } from '../../shared/voiceTranscript.js';
import { authenticatedFetch } from '../utils/api';
import { readVoiceConfig, voiceConfigHeaders, voiceCleanupOptions } from '../hooks/useVoiceConfig';

function directUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export function voiceConfigSignature(): string {
  return JSON.stringify(readVoiceConfig());
}

export async function transcribeVoice(blob: Blob, filename: string, { thorough = false } = {}): Promise<Response> {
  const config = readVoiceConfig();
  const body = new FormData();
  // A chunk that comes back short is re-recognised several ways on the server.
  const signal = AbortSignal.timeout(240000);

  if (config.baseUrl.trim()) {
    const options = voiceCleanupOptions();
    const split = splitWav(new Uint8Array(await blob.arrayBuffer()));
    const chunks = split?.chunks || [{ audio: new Uint8Array(await blob.arrayBuffer()), silent: false }];
    const parts: string[] = [];
    const headers: Record<string, string> = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
    for (const [index, chunk] of chunks.entries()) {
      if (chunk.silent) continue;
      let text = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const form = new FormData();
        form.append('file', new Blob([chunk.audio], { type: split ? 'audio/wav' : blob.type }), split ? `chunk-${index}.wav` : filename);
        form.append('model', config.sttModel || 'whisper-1');
        form.append('response_format', 'verbose_json');
        form.append('temperature', '0');
        if (options.language) form.append('language', options.language);
        const prompt = glossaryPrompt(options.dictionary, []);
        if (prompt && !attempt) form.append('prompt', prompt);
        const response = await fetch(directUrl(config.baseUrl.trim(), '/audio/transcriptions'), { method: 'POST', headers, body: form, signal });
        if (!response.ok) return response;
        const data = await response.json();
        text = cleanTranscript(typeof data.text === 'string' ? data.text
          : (data.segments || []).map((segment: { text?: string }) => (segment.text || '').trim()).join(' '));
        if (text) break;
      }
      if (!text) return Response.json({ error: `Не удалось распознать часть ${index + 1}. Запись сохранена — повтори распознавание.` }, { status: 422 });
      parts.push(text);
    }
    const raw = joinTranscripts(parts);
    let text = raw;
    if (raw && options.correction && options.correctionModel) {
      try {
        const response = await fetch(directUrl(config.baseUrl.trim(), '/chat/completions'), {
          method: 'POST', signal, headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: options.correctionModel, temperature: 0.2,
            max_completion_tokens: Math.min(8000, Math.max(1024, raw.length)),
            messages: [
              { role: 'system', content: buildCorrectionSystemPrompt(options.dictionary, options.fillerCleanup) },
              { role: 'user', content: raw },
            ],
          }),
        });
        if (response.ok) {
          const data = await response.json();
          const choice = data.choices?.[0];
          const candidate = String(choice?.message?.content || '').trim();
          if (choice?.finish_reason === 'stop' && correctionPreservesContent(raw, candidate, options.dictionary, options.fillerCleanup)) text = candidate;
        }
      } catch { /* Correction is optional; the complete raw text is retained. */ }
    }
    return Response.json({ text, raw, audioSeconds: split?.duration ?? null, chunks: chunks.length });
  }

  body.append('audio', blob, filename);
  // Cleanup config (glossary + toggles) travels as a form field, not a header —
  // a user's glossary can exceed header size limits. Server-side text cleanup
  // runs in the proxy; the direct-backend path uses the same preservation rules.
  body.append('options', JSON.stringify({ ...voiceCleanupOptions(), thorough }));
  return authenticatedFetch('/api/voice/transcribe', {
    method: 'POST',
    headers: voiceConfigHeaders(),
    body,
    signal,
  });
}

export function synthesizeVoice(text: string, signal: AbortSignal): Promise<Response> {
  const config = readVoiceConfig();

  if (config.baseUrl.trim()) {
    return fetch(directUrl(config.baseUrl.trim(), '/audio/speech'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.ttsModel || 'tts-1',
        voice: config.ttsVoice || 'alloy',
        input: text,
        ...(config.ttsFormat.trim() ? { response_format: config.ttsFormat.trim() } : {}),
      }),
      signal,
    });
  }

  return authenticatedFetch('/api/voice/tts', {
    method: 'POST',
    body: JSON.stringify({ text }),
    headers: voiceConfigHeaders(),
    signal,
  });
}

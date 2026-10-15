// Optional voice proxy — forwards STT/TTS to an OpenAI-compatible audio backend.
//
// The backend is whatever the user points at: OpenAI, Groq, or a local server
// (LocalAI / Speaches / Kokoro-FastAPI / openedai-speech / etc.). It must expose the
// standard OpenAI audio endpoints:
//     POST {base}/audio/transcriptions   (multipart 'file' + 'model')      -> { text }
//     POST {base}/audio/speech           ({ model, voice, input })         -> audio bytes
//
// Config is resolved per-request from headers (set by the client's voice settings),
// falling back to server env defaults. Mounted at /api/voice behind authenticateToken.
import fs from 'node:fs';
import { Readable } from 'node:stream';

import express from 'express';
import { HALLUCINATION_RE, dropHallucinatedEdges, cleanTranscript, countWords, glossaryPrompt, correctionPreservesContent, joinTranscripts, buildCorrectionSystemPrompt, transcriptLooksLossy } from '../shared/voiceTranscript.js';
import { splitWav, voicedSeconds } from '../shared/voiceAudio.js';

const ENV = {
  baseUrl: (process.env.VOICE_API_BASE_URL || '').replace(/\/$/, ''),
  apiKey: process.env.VOICE_API_KEY || '',
  sttModel: process.env.VOICE_STT_MODEL || 'whisper-1',
  ttsModel: process.env.VOICE_TTS_MODEL || 'tts-1',
  ttsVoice: process.env.VOICE_TTS_VOICE || 'alloy',
  // Text-cleanup defaults. The correction pass (punctuation, term fixes, filler
  // removal) runs only when a chat model is configured here or per-request.
  correctionModel: process.env.VOICE_CORRECTION_MODEL || '',
  language: process.env.VOICE_LANGUAGE || '',
  // Cleanup is on by default; it no-ops unless a correction model is available.
  correction: process.env.VOICE_CORRECTION !== 'false',
  // Optional server-side glossary, so dictation is good out of the box instead
  // of only for users who filled the glossary box in Settings -> Voice.
  dictionaryPath: process.env.VOICE_DICTIONARY_PATH || '',
};

// Reload the file when it changes on disk: the glossary is edited far more
// often than the server is restarted.
let diskGlossaryCache = { mtimeMs: -1, glossary: { dictionary: {}, keep: [], terms: [] } };

/**
 * Parse a glossary file. Accepts JSON ({ dictionary, keep } or a flat
 * canon -> [wrong, …] map) and the NeoWhisper YAML dialect: `canon: [a, b]`
 * lines under `slang:` / `terms:`, plus a `- word` list under `keep:`.
 * @param {string} text
 * @param {boolean} isJson
 * @returns {{dictionary: Record<string,string[]>, keep: string[], terms: string[]}}
 */
function parseGlossary(text, isJson) {
  if (isJson) {
    const data = JSON.parse(text);
    const dictionary = data && typeof data.dictionary === 'object' ? data.dictionary : data;
    return {
      dictionary: dictionary && typeof dictionary === 'object' ? dictionary : {},
      keep: Array.isArray(data?.keep) ? data.keep.map(String) : [],
      terms: Array.isArray(data?.terms) ? data.terms.map(String) : [],
    };
  }
  const dictionary = {};
  const keep = [];
  const terms = [];
  let section = '';
  for (const line of text.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const head = line.match(/^([A-Za-z_]+):\s*$/);
    if (head) {
      section = head[1];
      continue;
    }
    if (section === 'keep') {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) keep.push(item[1]);
      continue;
    }
    if (section === 'slang' || section === 'terms') {
      const entry = line.match(/^\s+(.+?):\s*\[(.*)\]\s*(?:#.*)?$/);
      if (entry) {
        const canon = entry[1].trim();
        const wrongs = entry[2].split(',').map((w) => w.trim()).filter(Boolean);
        dictionary[canon] = wrongs;
        if (section === 'terms') terms.push(canon);
      }
    }
  }
  return { dictionary, keep, terms };
}

/**
 * Glossary configured on the server, or empty when unset/unreadable. Never
 * throws: a broken glossary must not take dictation down with it.
 * @returns {{dictionary: Record<string,string[]>, keep: string[], terms: string[]}}
 */
function diskGlossary() {
  if (!ENV.dictionaryPath) return { dictionary: {}, keep: [], terms: [] };
  try {
    const { mtimeMs } = fs.statSync(ENV.dictionaryPath);
    if (mtimeMs !== diskGlossaryCache.mtimeMs) {
      const text = fs.readFileSync(ENV.dictionaryPath, 'utf8');
      const glossary = parseGlossary(text, ENV.dictionaryPath.endsWith('.json'));
      diskGlossaryCache = { mtimeMs, glossary };
      console.log(`[voice] glossary loaded: ${Object.keys(glossary.dictionary).length} terms, `
        + `${glossary.keep.length} keep-words from ${ENV.dictionaryPath}`);
    }
    return diskGlossaryCache.glossary;
  } catch (e) {
    console.warn(`[voice] glossary unreadable (${ENV.dictionaryPath}): ${e.message}`);
    return { dictionary: {}, keep: [], terms: [] };
  }
}

/**
 * Resolve the voice backend config for a request. Client headers (set from the
 * user's in-app voice settings) take precedence over the server env defaults.
 * @param {import('express').Request} req
 * @returns {{baseUrl: string, apiKey: string, sttModel: string, ttsModel: string, ttsVoice: string, ttsFormat: string}}
 */
function resolveConfig(req) {
  const h = req.headers;
  return {
    // Security: do not allow clients to control the outbound backend host.
    // Always use the server-side configured base URL.
    baseUrl: ENV.baseUrl,
    apiKey: String(h['x-voice-api-key'] || '') || ENV.apiKey,
    sttModel: String(h['x-voice-stt-model'] || '') || ENV.sttModel,
    ttsModel: String(h['x-voice-tts-model'] || '') || ENV.ttsModel,
    ttsVoice: String(h['x-voice-tts-voice'] || '') || ENV.ttsVoice,
    ttsFormat: String(h['x-voice-tts-format'] || '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Text cleanup pipeline (ported from the NeoWhisper desktop dictation tool).
// STT -> conservative artifact cleanup + chunk stitching -> optional LLM
// correction (punctuation, glossary term fixes, filler removal). Every stage is
// non-fatal: on any failure the previous, less-processed text is returned.
// ---------------------------------------------------------------------------

/**
 * Second-pass LLM correction against the same OpenAI-compatible backend.
 * Non-fatal and heavily guarded: returns rawText unchanged if the model was
 * truncated, answered instead of correcting, or the call fails.
 * @param {{baseUrl: string, apiKey: string}} cfg
 * @param {string} rawText
 * @param {{correctionModel: string, dictionary: Record<string,string[]>, fillerCleanup: boolean}} opts
 * @returns {Promise<string>}
 */
async function correctText(cfg, rawText, opts, keys) {
  const model = opts.correctionModel;
  if (!model || !rawText) return rawText;
  const makeBody = () => ({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      // Headroom for long dictations; without it Groq silently truncates.
      max_completion_tokens: Math.min(8000, Math.max(1024, rawText.length)),
      messages: [
        {
          role: 'system',
          content: buildCorrectionSystemPrompt(opts.dictionary, opts.fillerCleanup, opts.keepWords),
        },
        {
          role: 'user',
          content: 'Транскрипция между маркерами. Верни только исправленный текст, без маркеров.\n'
            + `---НАЧАЛО---\n${rawText}\n---КОНЕЦ---`,
        },
      ],
    }),
  });
  const r = await postWithRetry(`${cfg.baseUrl}/chat/completions`, keys, makeBody);
  if (!r.ok) return rawText; // non-fatal: raw is safer than an error
  const data = await r.json().catch(() => null);
  const choice = data && data.choices && data.choices[0];
  if (!choice || choice.finish_reason !== 'stop') return rawText;
  let text = String((choice.message && choice.message.content) || '').trim();
  for (const marker of ['---НАЧАЛО---', '---КОНЕЦ---']) text = text.split(marker).join('');
  text = text.trim();
  // Much longer = the model answered instead of correcting; much shorter =
  // truncated/eaten text. Either way the raw transcript is the safer choice.
  if (!correctionPreservesContent(rawText, text, opts.dictionary, opts.fillerCleanup)) {
    return rawText;
  }
  return text;
}

/**
 * Resolve per-request cleanup options from the multipart 'options' JSON field,
 * falling back to server env defaults. The dictionary is a { canon: [wrong,…] }
 * map parsed on the client from the user's glossary.
 * @param {import('express').Request} req
 * @returns {{correction: boolean, fillerCleanup: boolean, correctionModel: string, language: string, dictionary: Record<string,string[]>, keepWords: string[], hintTerms: string[], thorough: boolean}}
 */
function resolveCleanupOptions(req) {
  let o = {};
  try {
    if (req.body && typeof req.body.options === 'string') o = JSON.parse(req.body.options) || {};
  } catch {
    o = {};
  }
  const dict = o.dictionary && typeof o.dictionary === 'object' && !Array.isArray(o.dictionary) ? o.dictionary : {};
  // The user's own glossary wins; the server one is the default for everyone
  // who never opened Settings -> Voice.
  const fallback = diskGlossary();
  return {
    correction: typeof o.correction === 'boolean' ? o.correction : ENV.correction,
    fillerCleanup: typeof o.fillerCleanup === 'boolean' ? o.fillerCleanup : true,
    correctionModel: String(o.correctionModel || '') || ENV.correctionModel,
    language: String(o.language || '') || ENV.language,
    dictionary: { ...fallback.dictionary, ...dict },
    keepWords: fallback.keep,
    hintTerms: [...new Set([...Object.keys(dict), ...fallback.terms])],
    // Retry of a recording that already came back short: skip the quick recipes.
    thorough: o.thorough === true,
  };
}

const router = express.Router();

// Generous by default — local TTS can synthesize long messages at ~real-time on CPU.
// Guard against a non-numeric/zero override that would make setTimeout fire immediately.
const DEFAULT_VOICE_TIMEOUT_MS = 300000;
const _parsedTimeout = Number(process.env.VOICE_TIMEOUT_MS);
const VOICE_TIMEOUT_MS = Number.isFinite(_parsedTimeout) && _parsedTimeout > 0
  ? _parsedTimeout
  : DEFAULT_VOICE_TIMEOUT_MS;

/**
 * fetch() with an AbortController timeout so a stalled backend can't hold the
 * request open indefinitely. Aborts after VOICE_TIMEOUT_MS.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !isAllowedBackendUrl(parsed.origin)) {
    throw new Error('Blocked outbound voice backend URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT_MS);
  try {
    return await fetch(parsed.toString(), { redirect: 'manual', ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a backend fetch failure into a clear, actionable client response:
 * 504 on timeout (AbortError), 502 otherwise.
 * @param {import('express').Response} res
 * @param {Error} e
 */
function backendError(res, e) {
  if (e && e.name === 'AbortError') {
    return res.status(504).json({
      error: `Voice backend timed out after ${Math.round(VOICE_TIMEOUT_MS / 1000)}s. Check your voice backend.`,
    });
  }
  return res.status(502).json({ error: `Voice backend unreachable: ${e.message}` });
}

/**
 * SSRF guard for the user-configurable backend URL: allow http/https only and
 * block the link-local / cloud-metadata range (169.254.x). localhost and private
 * ranges are allowed on purpose so users can point at a local voice server
 * (LocalAI, Speaches, Kokoro-FastAPI, etc.).
 * @param {string} raw
 * @returns {boolean}
 */
function isAllowedBackendUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.hostname === '169.254.169.254' || u.hostname.startsWith('169.254.')) return false;
  return true;
}

/**
 * Relay an upstream (backend) error to the client without making an upstream
 * 401/403 look like the user's own app login failed.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} [text]
 */
function upstreamError(res, status, text) {
  if (status === 403 && /network settings|access denied/i.test(text)) {
    return res.status(502).json({ error: 'Groq отклонил соединение (403). Проверь VPN или сетевой маршрут; запись можно скачать и повторить.' });
  }
  if (status === 401 || status === 403) {
    return res.status(502).json({ error: 'Voice backend rejected the request (check the API key).' });
  }
  // 413 on a short dictation means the backend misread the clip length (a
  // browser recording without a duration header), not a real quota problem.
  if (status === 413) {
    return res.status(413).json({
      error: 'Voice backend rejected the recording as too long. Try a shorter dictation.',
    });
  }
  return res.status(status).json({ error: text || 'voice backend error' });
}

let _upload = null;
/**
 * Lazily build a memory-storage multer instance (25 MB cap) for audio uploads,
 * so multer is only imported when the voice feature is actually used.
 * @returns {Promise<import('multer').Multer>}
 */
async function getUpload() {
  if (!_upload) {
    const multer = (await import('multer')).default;
    _upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  }
  return _upload;
}

/**
 * Build the Authorization header for the backend, or an empty object when no
 * key is configured (e.g. a local server that needs none).
 * @param {string} apiKey
 * @returns {Record<string, string>}
 */
function authHeader(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// Free API tiers rate-limit per minute, and one dictation costs two calls
// (transcribe + correction), so a single key runs out mid-session. Accept a
// comma-separated VOICE_API_KEY and/or VOICE_API_KEY_1..N and rotate on 429/5xx.
const ENV_KEY_POOL = [
  ...String(process.env.VOICE_API_KEY || '').split(','),
  ...Object.keys(process.env)
    .filter((k) => /^VOICE_API_KEY_\d+$/.test(k))
    .sort()
    .map((k) => process.env[k]),
]
  .map((k) => String(k || '').trim())
  .filter(Boolean);

/**
 * Keys to try for this request: the client's own key wins outright (it is that
 * user's quota), otherwise rotate through the server's pool.
 * @param {{apiKey: string}} cfg
 * @param {import('express').Request} req
 * @returns {string[]}
 */
function keysFor(cfg, req) {
  const clientKey = String(req.headers['x-voice-api-key'] || '').trim();
  if (clientKey) return [clientKey];
  return ENV_KEY_POOL.length ? ENV_KEY_POOL : [cfg.apiKey];
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST to the backend, rotating keys and retrying transient failures so a rate
 * limit or a blip does not surface as a failed dictation. `makeBody` is called
 * per attempt because a FormData body cannot be reused once sent.
 * @param {string} url
 * @param {string[]} keys
 * @param {() => {body: BodyInit, headers?: Record<string,string>}} makeBody
 * @returns {Promise<Response>} the last response (ok, or the final failure)
 */
async function postWithRetry(url, keys, makeBody) {
  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const key = keys[attempt % keys.length];
    const { body, headers = {} } = makeBody();
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { ...headers, ...authHeader(key) },
      body,
    });
    if (response.ok || !RETRYABLE_STATUS.has(response.status)) return response;
    last = response;
    if (attempt === MAX_ATTEMPTS - 1) break;
    // Honour Retry-After when the backend sends one, else back off gently.
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 5000)
      : 400 * 2 ** attempt;
    console.warn(`[voice] ${response.status} from backend, retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
    await sleep(waitMs);
  }
  return last;
}

// Whisper sometimes swaps real speech for a YouTube outro («Субтитры делал
// DimaTorzok») or silently skips a stretch. A chunk whose text is far too
// short for the speech it holds is re-recognised in other ways — without the
// glossary hint, in 20-second pieces, with the sibling Groq model — and the
// fullest result wins. Each recipe is one entry; the first failure stays fatal.
const SHORT_PIECE_SECONDS = 20;
const SIBLING_MODEL = { 'whisper-large-v3': 'whisper-large-v3-turbo', 'whisper-large-v3-turbo': 'whisper-large-v3' };

async function recogniseOnce(cfg, keys, audio, { type, filename, prompt, model, temperature }) {
  const r = await postWithRetry(`${cfg.baseUrl}/audio/transcriptions`, keys, () => {
    const fd = new FormData();
    fd.append('file', new Blob([audio], { type }), filename);
    fd.append('model', model);
    fd.append('response_format', 'verbose_json');
    fd.append('temperature', String(temperature));
    if (cfg.language) fd.append('language', cfg.language);
    if (prompt) fd.append('prompt', prompt);
    return { body: fd };
  });
  const body = await r.text();
  if (!r.ok) return { failed: { status: r.status, body } };
  let data;
  try { data = JSON.parse(body); } catch { data = { text: body }; }
  // Full text is authoritative; segment-level confidence must never
  // silently remove genuine speech. Clean known artifacts textually.
  const heard = typeof data.text === 'string' ? data.text
    : (data.segments || []).map((segment) => String(segment.text || '').trim()).join(' ');
  const text = cleanTranscript(heard);
  return { text, hadJunk: countWords(text) < countWords(heard) };
}

async function recogniseInPieces(cfg, keys, audio, options) {
  const pieces = splitWav(audio, SHORT_PIECE_SECONDS)?.chunks || [];
  const texts = [];
  let hadJunk = false;
  for (const [index, piece] of pieces.entries()) {
    if (piece.silent) continue;
    const result = await recogniseOnce(cfg, keys, piece.audio, { ...options, filename: `piece-${index}.wav` });
    if (result.failed) return result;
    hadJunk ||= result.hadJunk;
    if (result.text) texts.push(result.text);
  }
  return { text: joinTranscripts(texts), hadJunk };
}

async function recogniseChunk(cfg, keys, chunk, { isWav, type, filename, gloss, thorough }) {
  const base = { type, filename, model: cfg.sttModel, temperature: 0 };
  const sibling = /groq\.com/.test(cfg.baseUrl) ? SIBLING_MODEL[cfg.sttModel] : null;
  const recipes = [
    !thorough && (() => recogniseOnce(cfg, keys, chunk.audio, { ...base, prompt: gloss })),
    !thorough && (() => recogniseOnce(cfg, keys, chunk.audio, base)),
    isWav && (() => recogniseInPieces(cfg, keys, chunk.audio, base)),
    isWav && thorough && (() => recogniseInPieces(cfg, keys, chunk.audio, { ...base, temperature: 0.2 })),
    sibling && (() => recogniseOnce(cfg, keys, chunk.audio, { ...base, model: sibling })),
  ].filter(Boolean);
  const voiced = isWav ? voicedSeconds(chunk.audio) : 0;
  let best = null;
  for (const [index, recipe] of recipes.entries()) {
    const result = await recipe();
    if (result.failed) {
      if (index === 0) return result;
      continue; // a fallback recipe failing must not lose what we already have
    }
    if (!best || countWords(result.text) > countWords(best.text)) best = result;
    if (result.text && !transcriptLooksLossy(result.text, voiced, result.hadJunk)) return { text: result.text, suspect: false };
  }
  return { text: best?.text || '', suspect: Boolean(best?.text) };
}

/**
 * GET /api/voice/health -> { configured } (true when a backend base URL is set).
 */
router.get('/health', (req, res) => {
  res.json({ configured: Boolean(resolveConfig(req).baseUrl) });
});

/**
 * POST /api/voice/transcribe (multipart 'audio') -> { text }.
 * Forwards the uploaded audio to the backend's /audio/transcriptions endpoint.
 */
router.post('/transcribe', async (req, res) => {
  const cfg = resolveConfig(req);
  if (!cfg.baseUrl) return res.status(503).json({ error: 'No voice backend configured' });
  if (!isAllowedBackendUrl(cfg.baseUrl)) return res.status(400).json({ error: 'Invalid voice backend URL.' });
  const upload = await getUpload();
  upload.single('audio')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
    const opts = resolveCleanupOptions(req);
    try {
      const split = splitWav(req.file.buffer);
      const chunks = split?.chunks || [{ audio: req.file.buffer, silent: false }];
      const keys = keysFor(cfg, req);
      const parts = [];
      let suspect = false;
      const gloss = glossaryPrompt(opts.dictionary, opts.hintTerms);
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        if (chunk.silent) continue;
        const result = await recogniseChunk({ ...cfg, language: opts.language }, keys, chunk, {
          isWav: Boolean(split),
          type: split ? 'audio/wav' : req.file.mimetype || 'audio/webm',
          filename: split ? `chunk-${index}.wav` : req.file.originalname || 'recording.webm',
          gloss,
          thorough: opts.thorough,
        });
        if (result.failed) return upstreamError(res, result.failed.status, result.failed.body);
        // Never return the other chunks as if a missing chunk had succeeded.
        if (!result.text) return res.status(422).json({ error: `Не удалось распознать часть ${index + 1} из ${chunks.length}. Запись сохранена — повтори распознавание.` });
        suspect ||= result.suspect;
        parts.push(result.text);
      }
      const raw = joinTranscripts(parts);

      // 3) Optional LLM correction (non-fatal — falls back to the cleaned raw).
      let final = raw;
      if (raw && opts.correction && opts.correctionModel && keys.some(Boolean)) {
        try {
          final = await correctText(cfg, raw, opts, keys);
        } catch (e) {
          // Never fail a dictation because the tidy-up step failed.
          console.warn(`[voice] correction failed, returning raw text: ${e.message}`);
          final = raw;
        }
      }
      final = cleanTranscript(final); // the corrector may re-spell the credit
      // suspect: some speech may still be missing; the client keeps the recording.
      res.json({ text: final, raw, audioSeconds: split?.duration ?? null, chunks: chunks.length, suspect });
    } catch (e) {
      backendError(res, e);
    }
  });
});

/**
 * POST /api/voice/tts { text } -> audio bytes.
 * Forwards the text to the backend's /audio/speech endpoint and streams the audio back.
 */
router.post('/tts', async (req, res) => {
  const cfg = resolveConfig(req);
  if (!cfg.baseUrl) return res.status(503).json({ error: 'No voice backend configured' });
  if (!isAllowedBackendUrl(cfg.baseUrl)) return res.status(400).json({ error: 'Invalid voice backend URL.' });
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text required' });
  try {
    const r = await fetchWithTimeout(`${cfg.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(cfg.apiKey) },
      body: JSON.stringify({
        model: cfg.ttsModel,
        voice: cfg.ttsVoice,
        input: text,
        ...(cfg.ttsFormat ? { response_format: cfg.ttsFormat } : {}),
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => 'tts failed');
      return upstreamError(res, r.status, errText);
    }
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).on('error', (error) => res.destroy(error)).pipe(res);
  } catch (e) {
    backendError(res, e);
  }
});

export {
  HALLUCINATION_RE,
  dropHallucinatedEdges,
  cleanTranscript,
  glossaryPrompt,
  buildCorrectionSystemPrompt,
  parseGlossary,
};

export default router;

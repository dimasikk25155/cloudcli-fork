/**
 * Short JSON completions from the local Ollama (Windows box, free, outside
 * the subscription limits). Shared by reply chips and vault-note suggestions.
 *
 * Best effort by contract: a slow, missing or confused model yields `null`,
 * never an exception — callers simply show nothing.
 *
 * Why Ollama's native `/api/chat` and not the OpenAI-compatible
 * `/v1/chat/completions`: the compatible endpoint ignores `think:false`, so
 * qwen3 spends the whole token budget on hidden reasoning and the answer is
 * cut off (seen live 2026-10-12). The native endpoint honours it.
 */
export const DEFAULT_LOCAL_LLM_BASE_URL = 'http://127.0.0.1:11435';
const MODEL_DEFAULTS = {
    suggest: { env: 'LOCAL_LLM_SUGGEST_MODEL', fallback: 'qwen3:8b' },
    memory: { env: 'LOCAL_LLM_MEMORY_MODEL', fallback: 'qwen3.5:9b' },
};
/** Model name for a purpose: env override or the decided default. */
export function localLlmModel(purpose) {
    const { env, fallback } = MODEL_DEFAULTS[purpose];
    return process.env[env]?.trim() || fallback;
}
export function localLlmBaseUrl() {
    return process.env.LOCAL_LLM_BASE_URL?.trim() || DEFAULT_LOCAL_LLM_BASE_URL;
}
/** Pull the first JSON value out of model text: bare, fenced, or embedded in prose. */
function parseJsonLoose(raw) {
    const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text) {
        return null;
    }
    const candidates = [text];
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fenced) {
        candidates.push(fenced[1].trim());
    }
    for (const [open, close] of [['{', '}'], ['[', ']']]) {
        const start = text.indexOf(open);
        const end = text.lastIndexOf(close);
        if (start !== -1 && end > start) {
            candidates.push(text.slice(start, end + 1));
        }
    }
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        }
        catch {
            // Try the next shape.
        }
    }
    return null;
}
export async function completeJson(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const baseUrl = (options.baseUrl ?? localLlmBaseUrl()).replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs));
    try {
        const response = await fetchImpl(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                model: options.model,
                stream: false,
                think: false,
                format: 'json',
                options: {
                    temperature: options.temperature ?? 0.4,
                    num_predict: options.maxTokens,
                    ...(options.numCtx ? { num_ctx: options.numCtx } : {}),
                },
                messages: [
                    { role: 'system', content: options.system },
                    { role: 'user', content: options.prompt },
                ],
            }),
        });
        if (!response.ok) {
            return null;
        }
        const data = (await response.json());
        const content = data?.message?.content;
        return typeof content === 'string' ? parseJsonLoose(content) : null;
    }
    catch {
        // Timeout (AbortError), refused connection, broken body: all mean "no answer".
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=local-llm.js.map
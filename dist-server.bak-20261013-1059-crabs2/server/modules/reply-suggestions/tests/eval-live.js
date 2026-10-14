/**
 * Live quality check of reply chips on real session endings — not part of
 * `npm test` (needs the local Ollama). Run from the fork root:
 *
 *   node_modules/.bin/tsx --tsconfig server/tsconfig.json \
 *     server/modules/reply-suggestions/tests/eval-live.ts [model] [out.json]
 *
 * Prints, per ending: model latency, raw model lines and what the filter kept.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, filterSuggestions, SYSTEM_PROMPT } from '../../../modules/reply-suggestions/reply-suggestions.prompt.js';
import { completeJson } from '../../../shared/local-llm.js';
import { classifyTurnEnding, finalParagraph } from '../../../shared/turn-ending.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const turns = JSON.parse(readFileSync(path.join(here, 'fixtures/real-turns.json'), 'utf8'));
const model = process.argv[2] || 'qwen3:8b';
const outPath = process.argv[3];
const results = [];
for (const turn of turns) {
    const ending = classifyTurnEnding(turn.assistant);
    const question = finalParagraph(turn.assistant);
    const started = Date.now();
    const raw = await completeJson({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt({ ...turn, question }),
        model,
        timeoutMs: 30000,
        maxTokens: 200,
        temperature: 0.3,
    });
    const ms = Date.now() - started;
    const rawLines = raw?.suggestions ?? raw;
    const kept = filterSuggestions(raw, question);
    results.push({ id: turn.id, ending: ending.kind, ms, raw: rawLines, kept });
    console.log(turn.id, ending.kind, `${ms}ms`, JSON.stringify(rawLines), '→', JSON.stringify(kept));
}
if (outPath) {
    writeFileSync(outPath, JSON.stringify(results, null, 2));
}
//# sourceMappingURL=eval-live.js.map
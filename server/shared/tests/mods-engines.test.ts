import assert from 'node:assert/strict';
import test from 'node:test';

import { MODS } from '../../../shared/mods.js';

// Story 46: every mod card says honestly where it works —
// «Claude ✓ · Codex ✓/частично/нет · Grok ✓/нет — почему».
test('every mod card names its support in Claude, Codex and Grok', () => {
  for (const mod of MODS) {
    assert.ok(mod.engines, `${mod.key} has no engines line`);
    assert.match(mod.engines, /^Claude ✓ · Codex (?:✓|частично|нет)(?: — [^·]+)? · Grok (?:✓|нет)(?:$| —)/, mod.key);
    // A limitation is explained after «—», not left as a bare «нет».
    if (/Codex (?:частично|нет)|Grok нет/.test(mod.engines)) assert.match(mod.engines, /—/, `${mod.key}: say why`);
  }
});

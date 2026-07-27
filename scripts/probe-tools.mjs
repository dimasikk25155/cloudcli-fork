// TEMPORARY DIAGNOSTIC — delete after use (see plan woolly-mapping-elephant).
// Replicates mapCliOptionsToSDK from server/claude-sdk.js to find out which
// SDK option makes ExitPlanMode disappear for Kimi plan-mode sessions.
// Usage: node scripts/probe-tools.mjs <scenario>
//   kimi          faithful prod config: kimi-k3 + plan + all fork options
//   kimi-notools  same, without the `tools` preset
//   kimi-noallowed same, without the plan-mode allowedTools append
//   kimi-noappend same, without systemPrompt.append
//   kimi-nomcp    same, without mcpServers
//   kimi-envkind  same, plus CLAUDE_CODE_ENVIRONMENT_KIND=anthropic
//   kimi-func     faithful config, model asked to call ExitPlanMode (functional)
//   claude        claude sonnet + plan control (spends Claude Max — only if needed)
import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scenario = process.argv[2] || 'kimi';
const KIMI_MODEL_MAP = { 'kimi-k3': 'k3', 'kimi-coding': 'kimi-for-coding', 'kimi-coding-highspeed': 'kimi-for-coding-highspeed' };
const MCP_DEFERRED_TOOLS_HINT =
  'Some MCP server tools (e.g. telegram, windows, playwright, ollama) are loaded ' +
  'on demand: only the server name is visible to you, not the individual tool ' +
  'schemas. Before calling any such MCP tool, first call the ToolSearch tool.';

const isKimi = scenario.startsWith('kimi');
const model = isKimi ? 'kimi-k3' : 'sonnet';

// Faithful copy of the fork's option builder (with per-scenario toggles).
function buildOptions() {
  const sdkOptions = {};
  sdkOptions.env = { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' };
  const cwd = join(tmpdir(), 'probe-tools-empty');
  mkdirSync(cwd, { recursive: true });
  sdkOptions.cwd = cwd;
  if (scenario !== 'kimi-default') {
    sdkOptions.permissionMode = 'plan';
  }

  let allowedTools = [];
  if (scenario !== 'kimi-noallowed') {
    allowedTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
  }
  sdkOptions.allowedTools = allowedTools;

  if (scenario !== 'kimi-notools') {
    sdkOptions.tools = { type: 'preset', preset: 'claude_code' };
  }
  sdkOptions.disallowedTools = [];
  sdkOptions.model = model;

  const kimiModel = KIMI_MODEL_MAP[model];
  if (kimiModel) {
    const kimiKey = (process.env.KIMI_CODE_KEY || '').trim();
    sdkOptions.model = kimiModel;
    sdkOptions.env = {
      ...sdkOptions.env,
      ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
      ANTHROPIC_API_KEY: kimiKey,
      ANTHROPIC_AUTH_TOKEN: kimiKey,
      ANTHROPIC_MODEL: kimiModel,
      ANTHROPIC_SMALL_FAST_MODEL: 'kimi-for-coding',
    };
    if (scenario === 'kimi-envkind') {
      sdkOptions.env.CLAUDE_CODE_ENVIRONMENT_KIND = 'anthropic';
    }
  } else {
    // Claude control: strip any Kimi routing inherited from this shell so the
    // CLI falls back to the logged-in Anthropic credentials.
    delete sdkOptions.env.ANTHROPIC_BASE_URL;
    delete sdkOptions.env.ANTHROPIC_API_KEY;
    delete sdkOptions.env.ANTHROPIC_AUTH_TOKEN;
    delete sdkOptions.env.ANTHROPIC_MODEL;
    delete sdkOptions.env.ANTHROPIC_SMALL_FAST_MODEL;
  }

  sdkOptions.systemPrompt = { type: 'preset', preset: 'claude_code' };
  if (kimiModel && scenario !== 'kimi-noappend') {
    sdkOptions.systemPrompt.append = MCP_DEFERRED_TOOLS_HINT;
  }

  sdkOptions.settingSources = ['project', 'user', 'local'];

  if (scenario !== 'kimi-nomcp') {
    try {
      const globalCfg = JSON.parse(readFileSync(join(process.env.HOME, '.claude.json'), 'utf8'));
      const mcpServers = globalCfg.mcpServers || {};
      if (mcpServers['obsidian-dimasik']) {
        mcpServers['obsidian-dimasik'] = { ...mcpServers['obsidian-dimasik'], alwaysLoad: true };
      }
      sdkOptions.mcpServers = mcpServers;
    } catch (e) {
      console.log('MCP config load failed (continuing without):', e.message);
    }
  }
  return sdkOptions;
}

const prompt = scenario === 'kimi-func'
  ? 'You are in plan mode. Call the ExitPlanMode tool NOW to present your plan. The plan is: do nothing. Do not call any skill, do not use Bash, just call ExitPlanMode.'
  : 'Reply with exactly: ok';

const WATCH = ['ExitPlanMode', 'AskUserQuestion', 'ToolSearch', 'Skill', 'exit_plan_mode'];

async function main() {
  const sdkOptions = buildOptions();
  // Functional run: allow only the interactive tools we test, deny the rest.
  sdkOptions.canUseTool = async (toolName) => {
    console.log(`[canUseTool] ${toolName}`);
    if (toolName === 'ExitPlanMode' || toolName === 'AskUserQuestion') {
      return { behavior: 'allow', updatedInput: {} };
    }
    return { behavior: 'deny', message: 'probe: not under test' };
  };

  const q = query({ prompt, options: sdkOptions });
  const hardTimeout = setTimeout(async () => {
    console.log('TIMEOUT — interrupting');
    try { await q.interrupt(); } catch {}
    process.exit(2);
  }, 120_000);

  let initSeen = false;
  const toolCalls = [];
  try {
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        initSeen = true;
        const tools = message.tools || [];
        console.log(`INIT model=${message.model} permissionMode=${message.permissionMode} tools=${tools.length}`);
        for (const name of WATCH) {
          console.log(`  watch ${name}: ${tools.includes(name) ? 'PRESENT' : 'MISSING'}`);
        }
        try {
          const usage = await q.getContextUsage();
          console.log(`CONTEXT deferredBuiltinTools: ${JSON.stringify((usage.deferredBuiltinTools || []).map(t => ({ name: t.name, isLoaded: t.isLoaded })))}`);
          console.log(`CONTEXT mcpTools unloaded: ${(usage.mcpTools || []).filter(t => t.isLoaded === false).map(t => t.name).join(',') || '(none flagged)'}`);
        } catch (e) {
          console.log('getContextUsage failed:', e.message);
        }
        if (scenario !== 'kimi-func') {
          clearTimeout(hardTimeout);
          try { await q.interrupt(); } catch {}
          break;
        }
      }
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            toolCalls.push(block.name);
            console.log(`[tool_use] ${block.name}`);
          }
        }
      }
      if (message.type === 'result') {
        console.log(`RESULT subtype=${message.subtype} tools_attempted=[${toolCalls.join(',')}]`);
        break;
      }
    }
  } catch (e) {
    console.log('query error:', e.message);
  } finally {
    clearTimeout(hardTimeout);
  }
  if (!initSeen) console.log('WARNING: init message never seen');
}

main();

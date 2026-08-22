import { randomUUID } from 'node:crypto';

import crossSpawn from 'cross-spawn';

import { GROK_FALLBACK_MODELS, resolveGrokModePreset } from './modules/providers/list/grok/grok-models.provider.js';
import { workModeInstruction } from './shared/work-mode.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  flattenPromptForWindowsShell,
  resolveGrokCliPath,
} from './shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activeGrokProcesses = new Map();

const GROK_INSTALL_HINT = 'Grok Build CLI is not installed. Install it: curl -fsSL https://x.ai/cli/install.sh | bash';

/**
 * Maps a CloudCLI permission mode onto Grok Build's `--permission-mode`.
 *
 * Grok accepts default | acceptEdits | auto | dontAsk | bypassPermissions | plan.
 * Headless runs (`grok -p`) have no TTY to prompt on, and a run that hits a
 * permission gate does not stall — it ends immediately with
 * `subtype: error_during_execution`, `stop_reason: cancelled` and no answer
 * text (verified on 1.0.5: `default` and `plan` both cancelled on the first
 * run_terminal_command, `bypassPermissions` finished with `end_turn`).
 *
 * So `default` maps to `auto` — the only non-bypass mode that actually
 * finishes unattended (measured on 1.0.5: `auto` → success/end_turn, while
 * `dontAsk` and `default` both cancelled on the same prompt). `plan` stays
 * read-only on purpose (its cancellation IS the plan gate);
 * `bypassPermissions` is the full-autonomy mode the composer's bypass chip
 * asks for. Exported for tests only.
 */
export function resolveGrokPermissionMode(permissionMode) {
  if (permissionMode === 'bypassPermissions') {
    return 'bypassPermissions';
  }
  // "Plan + auto-run". On Claude this is a real `plan` run whose ExitPlanMode
  // the client approves for the user; Grok has no permission prompts to
  // approve and a headless `plan` run just dies at the first tool call, so the
  // pairing is emulated: run with permissions granted and make the plan a
  // system rule instead (see AUTO_PLAN_RULE).
  if (permissionMode === 'planBypass') {
    return 'bypassPermissions';
  }
  if (permissionMode === 'plan') {
    return 'plan';
  }
  if (permissionMode === 'acceptEdits') {
    return 'acceptEdits';
  }
  return 'auto';
}

// The plan half of "plan + auto-run", as a rule instead of a permission gate.
// Deliberately tells the model NOT to wait for an approval: nobody is there to
// give one in a headless run, and waiting is what used to end the run empty.
const AUTO_PLAN_RULE = [
  'PLAN FIRST, THEN CARRY IT OUT.',
  'Open with a short numbered plan of what you are about to do, then execute it to the end in the same turn.',
  'Do not stop to ask for approval of the plan — you have it. Adjust the plan out loud if reality differs.',
].join(' ');

/**
 * Builds the `--rules` payload: the extra system-prompt text for one run.
 *
 * Grok Build reads CLAUDE.md, skills and hooks by itself (harness compat), so
 * the only thing that has to be injected per run is what the composer's chips
 * mean — the work mode, and the plan half of `planBypass`. Same instructions
 * the Claude runtime appends (server/shared/work-mode.ts), so a mode behaves
 * the same on both engines. Exported for tests only.
 */
export function buildGrokRules({ workMode, permissionMode, model }) {
  const rules = [];
  if (permissionMode === 'planBypass') {
    rules.push(AUTO_PLAN_RULE);
  }
  const presetRule = resolveGrokModePreset(model)?.rule;
  if (presetRule) {
    rules.push(presetRule);
  }
  // 'grok' dialect: the shared instructions name AskUserQuestion and the Skill
  // tool, neither of which exists in Grok Build's toolset — see work-mode.ts.
  const workModeText = workModeInstruction(workMode, permissionMode, 'grok');
  if (workModeText) {
    rules.push(workModeText);
  }
  return rules.length > 0 ? rules.join('\n\n') : null;
}

/**
 * Maps the composer's effort choice onto a level `--reasoning-effort` accepts.
 *
 * Two ways this used to kill a run outright (the CLI validates argv before it
 * talks to xAI, so the whole turn died with "unknown effort level"):
 *   - the composer's sentinel `default` — every provider sends it when the user
 *     has not picked a level, and Grok has no such level;
 *   - `xhigh` inherited from a Claude/Codex chat while Grok 4.5 is selected —
 *     4.5 only takes high/medium/low (see grok-models.provider.ts).
 * Anything not offered by the selected model is dropped, which leaves the CLI
 * on its own default. Same shape as resolveClaudeEffort / resolveOpenCodeEffort.
 * Exported for tests only.
 */
export function resolveGrokEffort(model, effort, modelsDefinition = GROK_FALLBACK_MODELS) {
  const requested = model || modelsDefinition?.DEFAULT;
  // The catalog's DEFAULT is a mode preset now, and a preset carries no effort
  // list of its own — so resolve it to the real model first, otherwise "no
  // model selected" would silently drop every level the user picked.
  const realModel = resolveGrokModePreset(requested)?.model ?? requested;
  const selectedModel = modelsDefinition?.OPTIONS?.find(
    (option) => option.value === realModel,
  ) || null;
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}

/**
 * Builds the headless argv for one Grok run. Exported for tests only.
 */
export function buildGrokArgs({ prompt, sessionId, resolvedSessionId, model, permissionMode, effort, workMode }) {
  // `--output-format streaming-messages-json` is NDJSON in the Anthropic
  // Messages API wire format — the same {type: system|assistant|user|result}
  // envelope Claude Code emits, which is why the sessions provider can parse
  // it without a shim.
  const args = [
    '-p', flattenPromptForWindowsShell(prompt?.trim() || ''),
    '--output-format', 'streaming-messages-json',
    '--permission-mode', resolveGrokPermissionMode(permissionMode),
  ];

  // Like Gemini (and unlike Kimi), Grok takes the session UUID up front, so
  // the id is known before the process starts and never has to be scraped out
  // of the stream. `-s` names a brand-new session, `--resume` continues one.
  if (sessionId) {
    args.push('--resume', sessionId);
  } else {
    args.push('-s', resolvedSessionId);
  }
  // A composer "mode" (grok-mode-fast, …) is a preset, not a model id: the CLI
  // would answer `unknown model id` and die before reaching xAI. This is the
  // single place where the preset becomes real flags — every dispatcher (chat,
  // agent-run, /api/agent) funnels through buildGrokArgs.
  const preset = resolveGrokModePreset(model);
  const resolvedModel = preset ? preset.model : model;
  if (resolvedModel) {
    args.push('-m', resolvedModel);
  }
  // A preset owns its level (that IS the mode), so the composer's effort chip —
  // which the UI hides for presets anyway — never overrides it. `null` means
  // "pass no flag at all" and leaves the CLI on its own default (Авто).
  const resolvedEffort = preset ? preset.effort : resolveGrokEffort(model, effort);
  if (resolvedEffort) {
    args.push('--reasoning-effort', resolvedEffort);
  }
  const rules = buildGrokRules({ workMode, permissionMode, model });
  if (rules) {
    args.push('--rules', rules);
  }

  return args;
}

async function spawnGrok(command, options = {}, ws) {
  return new Promise((resolve, reject) => {
    const { sessionId, projectPath, cwd, model, permissionMode, effort, workMode, sessionSummary } = options;
    const workingDir = cwd || projectPath || process.cwd();
    const resolvedSessionId = sessionId || randomUUID();
    const processKey = resolvedSessionId;
    let stdoutLineBuffer = '';
    let stderrBuffer = '';
    let terminalNotificationSent = false;
    let grokProcess = null;
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'grok',
          sessionId: resolvedSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'grok',
        sessionId: resolvedSessionId,
        sessionName: sessionSummary,
        error: error || `Grok Build CLI exited with code ${code}`,
      });
    };

    const processGrokOutputLine = (line) => {
      if (!line || !line.trim()) {
        return;
      }

      let response;
      try {
        response = JSON.parse(line);
      } catch {
        ws.send(createNormalizedMessage({
          kind: 'stream_delta',
          content: line,
          sessionId: resolvedSessionId,
          provider: 'grok',
        }));
        return;
      }

      try {
        const normalized = sessionsService.normalizeMessage('grok', response, resolvedSessionId);
        for (const msg of normalized) {
          ws.send(msg);
        }
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[Grok] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: resolvedSessionId,
          provider: 'grok',
        }));
      }
    };

    void providerModelsService.resolveResumeModel('grok', sessionId, model).then(async (resolvedModel) => {
      // Sessions live under ~/.grok/sessions/<url-encoded cwd>/<uuid>/, so cwd
      // decides which project a session belongs to.
      const args = buildGrokArgs({
        prompt: command,
        sessionId,
        resolvedSessionId,
        model: resolvedModel,
        permissionMode,
        effort,
        workMode,
      });

      grokProcess = spawnFunction(resolveGrokCliPath(), args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      activeGrokProcesses.set(processKey, grokProcess);
      grokProcess.sessionId = resolvedSessionId;
      grokProcess.stdin.end();

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(resolvedSessionId);
      }

      if (!sessionId) {
        ws.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: resolvedSessionId,
          sessionId: resolvedSessionId,
          provider: 'grok',
        }));
      }

      grokProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processGrokOutputLine(line.trim());
        });
      });

      grokProcess.stderr.on('data', (data) => {
        // Progress noise and update notices land on stderr even on healthy
        // runs, so it is NOT streamed to the UI as errors — it is buffered and
        // only surfaced if the run actually fails.
        stderrBuffer += data.toString();
        if (stderrBuffer.length > 8192) {
          stderrBuffer = stderrBuffer.slice(-8192);
        }
      });

      grokProcess.on('close', async (code) => {
        activeGrokProcesses.delete(processKey);

        if (stdoutLineBuffer.trim()) {
          processGrokOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        if (code !== 0 && stderrBuffer.trim()) {
          ws.send(createNormalizedMessage({
            kind: 'error',
            content: stderrBuffer.trim(),
            sessionId: resolvedSessionId,
            provider: 'grok',
          }));
        }

        // Terminal complete — skipped for aborted runs (abort-session
        // already sent the aborted complete on this run's behalf).
        if (!completeSent && !grokProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'grok', sessionId: resolvedSessionId, exitCode: code }));
        }

        if (code === 0) {
          notifyTerminalState({ code });
          resolve();
          return;
        }

        if (code === 127 || code === null) {
          const installed = await providerAuthService.isProviderInstalled('grok');
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: GROK_INSTALL_HINT,
              sessionId: resolvedSessionId,
              provider: 'grok',
            }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Grok Build CLI process was terminated' : `Grok Build CLI exited with code ${code}`));
      });

      grokProcess.on('error', async (error) => {
        activeGrokProcesses.delete(processKey);

        const installed = await providerAuthService.isProviderInstalled('grok');
        const errorContent = !installed ? GROK_INSTALL_HINT : error.message;

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: resolvedSessionId,
          provider: 'grok',
        }));
        if (!completeSent && !grokProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'grok', sessionId: resolvedSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortGrokSession(sessionId) {
  const process = activeGrokProcesses.get(sessionId);
  if (!process) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  process.aborted = true;
  process.kill('SIGTERM');
  activeGrokProcesses.delete(sessionId);
  return true;
}

function isGrokSessionActive(sessionId) {
  return activeGrokProcesses.has(sessionId);
}

function getActiveGrokSessions() {
  return Array.from(activeGrokProcesses.keys());
}

export {
  spawnGrok,
  abortGrokSession,
  isGrokSessionActive,
  getActiveGrokSessions,
};

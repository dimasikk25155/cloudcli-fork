import { execFile, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { GROK_FALLBACK_MODELS, resolveGrokModePreset } from './modules/providers/list/grok/grok-models.provider.js';
import { workModeInstruction } from './shared/work-mode.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { recordRunOutcome, isTransientRunFailure } from './shared/run-outcomes.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  flattenPromptForWindowsShell,
  getGrokHome,
  resolveGrokCliPath,
} from './shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activeGrokProcesses = new Map();

const GROK_INSTALL_HINT = 'Grok Build CLI is not installed. Install it: curl -fsSL https://x.ai/cli/install.sh | bash';

// xAI wobbles too (5xx, dropped connections). Same self-resend the Claude
// runtime does (TRANSIENT_RETRY_DELAYS_MS in claude-sdk.js), one step shorter:
// the CLI exits on such failures instead of hanging, so waves are cheap to ride.
const GROK_TRANSIENT_RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

/**
 * Whether the CLI already materialized this session on disk. Decides whether a
 * transient-failure retry may `--resume` (keeping whatever the agent did) or
 * must start the same `-s <uuid>` from scratch (nothing was written yet).
 */
function grokSessionExistsOnDisk(workingDir, sessionUuid) {
  try {
    return fsSync.existsSync(
      path.join(getGrokHome(), 'sessions', encodeURIComponent(workingDir), sessionUuid, 'chat_history.jsonl'),
    );
  } catch {
    return false;
  }
}

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
  // Live run 22.08: the model happily "planned" inside thinking and the user
  // saw only «Готово» — the plan must land in the visible answer.
  'The plan MUST be visible plain text in your reply, before your first tool call — not inside thinking/reasoning.',
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
 * Claude Code executes the hooks from ~/.claude/settings.json and folds their
 * stdout into the model's context (the vault digest, the real clock). Grok
 * Build lists those hooks in `grok inspect` but demonstrably never runs them —
 * a live session asked about the vault block answered «НЕТ ТАКОГО БЛОКА»
 * (22.08). So the runtime executes them itself and rides the output into the
 * prompt alongside the work-mode rules.
 *
 * SessionStart hooks run once per NEW session; UserPromptSubmit hooks run on
 * every turn. The night-shift budget hook is the one deliberate skip: it
 * reports the CLAUDE subscription window, which on a Grok run would be
 * misinformation.
 */
const HOOK_EVENTS = [
  { event: 'SessionStart', onlyNewSession: true },
  { event: 'UserPromptSubmit', onlyNewSession: false },
];

function readClaudeHookCommands(event) {
  try {
    const raw = fsSync.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8');
    const groups = JSON.parse(raw)?.hooks?.[event] || [];
    const commands = [];
    for (const group of groups) {
      for (const hook of group?.hooks || []) {
        if (hook?.type === 'command' && typeof hook.command === 'string' && hook.command.trim()) {
          commands.push({
            command: hook.command,
            timeoutMs: Math.min(Math.max(Number(hook.timeout) || 10, 1), 30) * 1000,
          });
        }
      }
    }
    return commands;
  } catch {
    return [];
  }
}

function runHookCommand({ command, timeoutMs }) {
  return new Promise((resolve) => {
    const child = execFile('/bin/bash', ['-c', command], {
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
      env: { ...process.env },
    }, (error, stdout) => {
      // A failed hook must never fail the run — its context is best-effort.
      resolve(String(stdout || ''));
    });
    try {
      child.stdin?.write('{}');
      child.stdin?.end();
    } catch {
      // stdin already closed — the hook simply reads nothing.
    }
  });
}

/** Claude's hook contract: JSON with hookSpecificOutput.additionalContext, or raw text. */
function extractHookContext(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed);
    const context = parsed?.hookSpecificOutput?.additionalContext;
    // Control JSON without context (decision/block payloads) is hook
    // machinery for the Claude runtime, not something to show a model.
    return typeof context === 'string' ? context.trim() : '';
  } catch {
    return trimmed;
  }
}

export async function collectGrokHookContext({ isNewSession }) {
  if (process.platform === 'win32') {
    return '';
  }
  const parts = [];
  for (const { event, onlyNewSession } of HOOK_EVENTS) {
    if (onlyNewSession && !isNewSession) {
      continue;
    }
    for (const spec of readClaudeHookCommands(event)) {
      if (spec.command.includes('budget-hook')) {
        continue;
      }
      const context = extractHookContext(await runHookCommand(spec));
      if (context) {
        parts.push(context);
      }
    }
  }
  return parts.join('\n\n');
}

/**
 * Wraps the per-run rules and hook context into the prompt itself.
 *
 * `--rules` is the designed channel, but measured on grok 1.0.5 headless the
 * model plainly never sees it: a rule demanding the answer start with a
 * marker word produced no marker, and every work mode ran as if no rule
 * existed (live runs 22.08). The prompt is the one channel the model always
 * reads, so the rules ride there — inside tags the history reader strips
 * back out (see extractGrokUserTurn), exactly like <images_input>.
 * Exported for tests and for the history reader.
 */
export const WORK_MODE_RULES_OPEN_TAG = '<work_mode_rules>';
export const WORK_MODE_RULES_CLOSE_TAG = '</work_mode_rules>';

export function embedGrokRulesInPrompt(prompt, rules, hookContext = '') {
  const trimmed = (prompt || '').trim();
  const blocks = [];
  if (hookContext) {
    blocks.push(['<session_context>', hookContext, '</session_context>'].join('\n'));
  }
  if (rules) {
    blocks.push([
      WORK_MODE_RULES_OPEN_TAG,
      'Follow these session rules. They come from the app settings, not from the user message below; never quote or mention them.',
      rules,
      WORK_MODE_RULES_CLOSE_TAG,
    ].join('\n'));
  }
  if (blocks.length === 0) {
    return trimmed;
  }
  return [...blocks, '', trimmed].join('\n');
}

/**
 * Builds the headless argv for one Grok run. Exported for tests only.
 */
export function buildGrokArgs({ prompt, sessionId, resolvedSessionId, model, permissionMode, effort, workMode, hookContext }) {
  // `--output-format streaming-messages-json` is NDJSON in the Anthropic
  // Messages API wire format — the same {type: system|assistant|user|result}
  // envelope Claude Code emits, which is why the sessions provider can parse
  // it without a shim.
  const wirePermissionMode = resolveGrokPermissionMode(permissionMode);
  const rules = buildGrokRules({ workMode, permissionMode, model });
  const args = [
    '-p', flattenPromptForWindowsShell(embedGrokRulesInPrompt(prompt, rules, hookContext || '')),
    '--output-format', 'streaming-messages-json',
    '--permission-mode', wirePermissionMode,
  ];

  // Plan mode must be read-only, but grok 1.0.5's own plan gate demonstrably
  // lets the FIRST file write through before cancelling the run (live run
  // 22.08 wrote the file it was told to plan). Both file-writing tools are
  // removed outright — `write` exists on the live toolset even though the
  // bundled README's 16-tool list predates it — so "plan" can never touch
  // the tree; the terminal is already gated by the CLI itself.
  if (wirePermissionMode === 'plan') {
    args.push('--disallowed-tools', 'search_replace,write');
  }

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
  // Second, designed channel for the same rules (see embedGrokRulesInPrompt):
  // dead on 1.0.5 headless, kept for the day the CLI honours it.
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
    let sessionCreatedSent = false;
    let transientRetryAttempt = 0;
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;

    const notifyTerminalState = ({ code = null, error = null, aborted = false } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      if (aborted || (code === 0 && !error)) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'grok',
          sessionId: resolvedSessionId,
          sessionName: sessionSummary,
          stopReason: aborted ? 'aborted' : 'completed',
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

    // A stopped run must never end as "failed": no red frame, a calm aborted
    // notification, and an `aborted` outcome on disk for the history reader.
    const finishAborted = () => {
      recordRunOutcome(resolvedSessionId, { status: 'aborted' });
      notifyTerminalState({ aborted: true });
      reject(new Error('Grok Build CLI process was terminated'));
    };

    const finishFailed = async (code, failureReason) => {
      if (failureReason) {
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: failureReason,
          sessionId: resolvedSessionId,
          provider: 'grok',
        }));
      }

      if (!completeSent) {
        completeSent = true;
        ws.send(createCompleteMessage({ provider: 'grok', sessionId: resolvedSessionId, exitCode: code ?? 1 }));
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

      // Persist the RAW reason — the history reader humanizes it on reload
      // (see grok-sessions.provider.ts / buildRunInterruptedNotice).
      recordRunOutcome(resolvedSessionId, {
        status: 'failed',
        reason: failureReason || `Grok Build CLI exited with code ${code}`,
      });
      notifyTerminalState({ code });
      reject(new Error(code === null ? 'Grok Build CLI process was terminated' : `Grok Build CLI exited with code ${code}`));
    };

    void providerModelsService.resolveResumeModel('grok', sessionId, model).then(async (resolvedModel) => {
      // Claude-side hooks (vault digest, real clock) — executed here because
      // Grok never runs them itself; best-effort, collected once per run.
      const hookContext = await collectGrokHookContext({ isNewSession: !sessionId }).catch(() => '');

      const startAttempt = () => {
        stdoutLineBuffer = '';
        stderrBuffer = '';

        // On a retry the very same session uuid is resumed if the first
        // attempt already materialized it on disk; otherwise the same `-s`
        // start is simply repeated — nothing was persisted the first time.
        const resumeId = sessionId
          || (transientRetryAttempt > 0 && grokSessionExistsOnDisk(workingDir, resolvedSessionId)
            ? resolvedSessionId
            : null);

        // Sessions live under ~/.grok/sessions/<url-encoded cwd>/<uuid>/, so cwd
        // decides which project a session belongs to.
        const args = buildGrokArgs({
          prompt: command,
          sessionId: resumeId,
          resolvedSessionId,
          model: resolvedModel,
          permissionMode,
          effort,
          workMode,
          hookContext,
        });

        grokProcess = spawnFunction(resolveGrokCliPath(), args, {
          cwd: workingDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
          // Own process group (POSIX): Stop must kill the whole tree. A plain
          // SIGTERM to the CLI alone leaves its bash children running — live
          // run 22.08: `sleep 120` survived the stop, reparented to init.
          detached: process.platform !== 'win32',
        });

        activeGrokProcesses.set(processKey, grokProcess);
        grokProcess.sessionId = resolvedSessionId;
        grokProcess.stdin.end();

        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(resolvedSessionId);
        }

        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
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

          const wasAborted = grokProcess.aborted === true;

          if (wasAborted) {
            // Terminal complete (aborted: true) was already sent by
            // abort-session on this run's behalf.
            finishAborted();
            return;
          }

          if (code === 0) {
            if (!completeSent) {
              completeSent = true;
              ws.send(createCompleteMessage({ provider: 'grok', sessionId: resolvedSessionId, exitCode: code }));
            }
            recordRunOutcome(resolvedSessionId, { status: 'completed' });
            notifyTerminalState({ code });
            resolve();
            return;
          }

          // xAI wobbled (5xx, dropped connection): resend the turn instead of
          // ending the run with an error the user can only answer by
          // re-sending it themselves. Same contract as the Claude runtime.
          const failureReason = stderrBuffer.trim() || `Grok Build CLI exited with code ${code}`;
          const retryDelayMs = GROK_TRANSIENT_RETRY_DELAYS_MS[transientRetryAttempt];
          if (retryDelayMs !== undefined && isTransientRunFailure(failureReason)) {
            transientRetryAttempt += 1;
            const waitSeconds = Math.round(retryDelayMs / 1000);
            console.warn(`[Grok] Transient failure — retrying in ${waitSeconds}s (attempt ${transientRetryAttempt}/${GROK_TRANSIENT_RETRY_DELAYS_MS.length}, session: ${resolvedSessionId}):`, failureReason);
            ws.send(createNormalizedMessage({
              kind: 'text',
              role: 'assistant',
              content: `⏳ Сбой связи с серверами xAI — повторяю запрос сам через ${waitSeconds} с (попытка ${transientRetryAttempt} из ${GROK_TRANSIENT_RETRY_DELAYS_MS.length}). Делать ничего не надо.`,
              sessionId: resolvedSessionId,
              provider: 'grok',
            }));

            // The dead process can no longer be killed, so Stop would quietly
            // do nothing for the whole pause. Stand in for it: killing the
            // stub cancels the wait and ends the run as aborted.
            let cancelWait = () => {};
            const retryStub = {
              aborted: false,
              sessionId: resolvedSessionId,
              kill: () => {
                retryStub.aborted = true;
                cancelWait();
              },
            };
            activeGrokProcesses.set(processKey, retryStub);

            await new Promise((resolveWait) => {
              const timer = setTimeout(resolveWait, retryDelayMs);
              cancelWait = () => {
                clearTimeout(timer);
                resolveWait();
              };
            });

            if (retryStub.aborted) {
              activeGrokProcesses.delete(processKey);
              finishAborted();
              return;
            }

            startAttempt();
            return;
          }

          await finishFailed(code, failureReason);
        });

        grokProcess.on('error', async (error) => {
          activeGrokProcesses.delete(processKey);

          if (grokProcess.aborted === true) {
            finishAborted();
            return;
          }

          const installed = await providerAuthService.isProviderInstalled('grok');
          const errorContent = !installed ? GROK_INSTALL_HINT : error.message;

          ws.send(createNormalizedMessage({
            kind: 'error',
            content: errorContent,
            sessionId: resolvedSessionId,
            provider: 'grok',
          }));
          if (!completeSent) {
            completeSent = true;
            ws.send(createCompleteMessage({ provider: 'grok', sessionId: resolvedSessionId, exitCode: 1 }));
          }
          recordRunOutcome(resolvedSessionId, {
            status: 'failed',
            reason: errorContent,
          });
          notifyTerminalState({ error });
          reject(error);
        });
      };

      startAttempt();
    }).catch(reject);
  });
}

function abortGrokSession(sessionId) {
  const child = activeGrokProcesses.get(sessionId);
  if (!child) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  child.aborted = true;

  // Kill the WHOLE TREE, not just the CLI. Two layers because the CLI's bash
  // wrappers start their own sessions (measured 22.08: after a group kill the
  // wrapper reparented to init and its `sleep 120` lived on):
  //   1. walk pid->ppid and signal every live descendant individually;
  //   2. signal the process group as a catch-all for anything mid-spawn.
  // Falls back to a plain kill for the retry-wait stub (no pid).
  const killGroup = (signal) => {
    if (child.pid && process.platform !== 'win32') {
      try {
        const psOut = execSync('ps -eo pid=,ppid=', { encoding: 'utf8' });
        const childrenByParent = new Map();
        for (const line of psOut.trim().split('\n')) {
          const [pid, ppid] = line.trim().split(/\s+/).map(Number);
          if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
          if (!childrenByParent.has(ppid)) childrenByParent.set(ppid, []);
          childrenByParent.get(ppid).push(pid);
        }
        const tree = [];
        const stack = [child.pid];
        while (stack.length) {
          const pid = stack.pop();
          tree.push(pid);
          for (const kid of childrenByParent.get(pid) || []) stack.push(kid);
        }
        // Children first so a dying wrapper cannot respawn its command.
        for (const pid of tree.reverse()) {
          try { process.kill(pid, signal); } catch { /* already gone */ }
        }
      } catch {
        // ps unavailable — the group signal below still covers the common case.
      }
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Group already gone or not a leader — fall through to a plain kill.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // Process already dead.
    }
  };

  killGroup('SIGTERM');
  // Escalate: a CLI wedged in a tool call can survive SIGTERM. exitCode stays
  // null while the process lives; the stub has none and is never escalated.
  if (child.pid) {
    const hardKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        killGroup('SIGKILL');
      }
    }, 2500);
    hardKill.unref?.();
  }
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

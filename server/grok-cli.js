import { execFile, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { GROK_FALLBACK_MODELS, resolveGrokModePreset } from './modules/providers/list/grok/grok-models.provider.js';
import { workModeInstruction } from './shared/work-mode.js';
import {
  appendImagesInputTag,
  appendVisibleImagePathsTag,
  buildGrokUserContent,
  normalizeImageDescriptors,
  parseImagesInputTag,
} from './shared/image-attachments.js';
import {
  fromGrokAskUserQuestionTool,
  isGrokAskUserQuestionTool,
  parseGrokNumberedQuestion,
  registerGrokPlanExit,
  registerGrokQuestion,
  takeGrokQuestionsForAppSession,
  toAskUserQuestionInput,
} from './shared/grok-question.js';
import { sessionsDb } from './modules/database/index.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import {
  composeGrokSessionTitle,
  isPlaceholderGrokSessionTitle,
} from './modules/providers/list/grok/grok-session-title.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { recordRunOutcome, isTransientRunFailure } from './shared/run-outcomes.js';
import { readGrokContextBudget } from './shared/grok-usage.js';
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

/**
 * Writes a short Russian title on a brand-new Grok chat. Must never throw:
 * a missed name is better than blocking the run.
 */
function maybeApplyGrokSessionTitle(appSessionId, prompt) {
  if (!appSessionId) {
    return;
  }
  try {
    const row = sessionsDb.getSessionById(String(appSessionId));
    if (!row || !isPlaceholderGrokSessionTitle(row.custom_name)) {
      return;
    }
    const title = composeGrokSessionTitle(typeof prompt === 'string' ? prompt : '');
    if (!title || isPlaceholderGrokSessionTitle(title)) {
      return;
    }
    sessionsDb.updateSessionCustomName(row.session_id, title);
  } catch {
    /* titling is best-effort */
  }
}

// xAI wobbles too (5xx, dropped connections). Same self-resend the Claude
// runtime does (TRANSIENT_RETRY_DELAYS_MS in claude-sdk.js), one step shorter:
// the CLI exits on such failures instead of hanging, so waves are cheap to ride.
const GROK_TRANSIENT_RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

/** Cap one NDJSON stdout line. A Suno/file-read tool_result without a newline
 * used to grow until the process died and the chat looked aborted. */
const MAX_GROK_STDOUT_LINE_CHARS = 2 * 1024 * 1024;

// Live hangs (2026-09-06, 2026-09-11): Grok CLI can sit in session_create /
// futex with 0% CPU, no children, no stdout. Keepalive ticks still move the
// UI clock, so the pill says «Рассуждает» for 40+ min. The CLI's own idle
// timeout is an hour. We cut that off here.
export const GROK_FIRST_BYTE_MS = 90_000;
export const GROK_IDLE_SILENCE_MS = 8 * 60_000;
const GROK_ABORT_TERM_MS = 2_500;
const GROK_ABORT_KILL_MS = 2_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether this Grok run looks wedged (no stream, nothing for the user to wait
 * for). Exported for tests only.
 *
 * `first_byte`: spawned and never printed NDJSON — the abort→resume race
 * (old CLI still holding session files) and a stuck session_create.
 * `idle_silence`: had output, then went quiet with no child processes.
 * Long tool calls have children, so they do not trip this.
 */
export function grokHangReason({ spawnedAt, firstByteAt, lastStdoutAt, now, hasChildren }) {
  if (!Number.isFinite(spawnedAt) || !Number.isFinite(now) || now < spawnedAt) {
    return null;
  }
  if (firstByteAt == null) {
    return (now - spawnedAt) >= GROK_FIRST_BYTE_MS ? 'first_byte' : null;
  }
  if (hasChildren) {
    return null;
  }
  const last = Number.isFinite(lastStdoutAt) ? lastStdoutAt : firstByteAt;
  return (now - last) >= GROK_IDLE_SILENCE_MS ? 'idle_silence' : null;
}

export function grokHangUserMessage(reason) {
  if (reason === 'first_byte') {
    return 'Grok завис на старте — за 90 с не прислал ни строки. Обычно после Стоп/нового сообщения в том же чате: старый процесс ещё держал файлы. Этот чат больше не резюмь, открой новый и напиши «продолжи».';
  }
  return 'Grok завис: процесс жив, но молчит и ничего не делает уже 8 минут. Нажми Стоп и продолжи в новом чате.';
}

function pidIsAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, timeoutMs) {
  if (!pid) {
    return true;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidIsAlive(pid)) {
      return true;
    }
    await sleep(100);
  }
  return !pidIsAlive(pid);
}

function grokHasDirectChildren(pid) {
  // Unknown → assume busy so a Windows box (or a missing pgrep) never kills
  // a legitimate long tool call.
  if (!pid || process.platform === 'win32') {
    return true;
  }
  try {
    execSync(`pgrep -P ${Number(pid)}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function listOrphanGrokPidsForSession(sessionUuid) {
  if (process.platform === 'win32' || !sessionUuid) {
    return [];
  }
  try {
    const out = execSync('ps -eo pid=,args=', {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    const pids = [];
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      const space = trimmed.indexOf(' ');
      if (space < 0) {
        continue;
      }
      const pid = Number(trimmed.slice(0, space));
      const args = trimmed.slice(space + 1);
      if (!Number.isFinite(pid) || pid === process.pid) {
        continue;
      }
      if (args.includes('--resume') && args.includes(sessionUuid) && /(^|\/)grok(\s|$)/.test(args)) {
        pids.push(pid);
      }
    }
    return pids;
  } catch {
    return [];
  }
}

function killGrokProcessTree(child, signal) {
  if (!child) {
    return;
  }
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
}

function releaseGrokProcess(processKey, child) {
  if (activeGrokProcesses.get(processKey) === child) {
    activeGrokProcesses.delete(processKey);
  }
}

async function killOrphanGrokPids(sessionUuid) {
  const leftovers = listOrphanGrokPidsForSession(sessionUuid);
  for (const pid of leftovers) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  if (leftovers.length === 0) {
    return;
  }
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && listOrphanGrokPidsForSession(sessionUuid).length > 0) {
    await sleep(100);
  }
}

async function ensurePreviousGrokRunDead(sessionUuid) {
  if (!sessionUuid) {
    return;
  }
  if (activeGrokProcesses.has(sessionUuid)) {
    await abortGrokSession(sessionUuid);
    return;
  }
  await killOrphanGrokPids(sessionUuid);
}

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
  // two-phase system rule instead (see AUTO_PLAN_ASK_RULE / AUTO_PLAN_RUN_RULE).
  if (permissionMode === 'planBypass') {
    return 'bypassPermissions';
  }
  // Grok's native `plan` gate cancels the run on the first tool call
  // (measured 1.0.5) — the user never sees a plan to approve. Emulate
  // Claude: permissions granted, writes stripped, a rule that ENDS on
  // the plan, then a synthetic ExitPlanMode prompt.
  if (permissionMode === 'plan') {
    return 'bypassPermissions';
  }
  if (permissionMode === 'acceptEdits') {
    return 'acceptEdits';
  }
  return 'auto';
}

// Linux MAX_ARG_STRLEN is 128 KiB per argv entry. `--prompt-json` with a
// camera photo as base64 dies as spawn E2BIG: the CLI never starts, the turn
// is not persisted, and the chat bubble vanishes on refresh. Stay under that.
export const MAX_GROK_PROMPT_ARGV_CHARS = 96 * 1024;

export function grokPromptFitsArgv(value) {
  return typeof value === 'string' && value.length <= MAX_GROK_PROMPT_ARGV_CHARS;
}

function writeGrokPromptFile(contents) {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'grok-prompt-'));
  const file = path.join(dir, 'prompt.txt');
  fsSync.writeFileSync(file, contents, { encoding: 'utf8', mode: 0o600 });
  return { file, dir };
}

function cleanupGrokPromptDir(dir) {
  if (!dir) {
    return;
  }
  try {
    fsSync.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// "Планирование + обход" as Dima uses it on Claude: analyze, ask 3–4 questions
// that change goal/duration/scope, WAIT, then write a real plan and carry it
// out. A three-bullet "then I start" list is not this mode (live complaint
// 24.08). Phase `ask` is the first turn; phase `run` is the answer turn.
const AUTO_PLAN_ASK_RULE = [
  'HARD RULE, PLANNING + BYPASS — QUESTIONS FIRST.',
  'This mode is on for EVERY user message, including a greeting or a single word.',
  'You MAY look around (read, search, list) to understand the request.',
  'You MUST NOT create, edit or delete files, and MUST NOT run commands that change state, until the user has answered.',
  'Your first user-visible output is 2-4 clarifying questions that change the GOAL, DURATION, or SCOPE of the work.',
  'Ask them with ask_user_question (concrete options, not open prose) and STOP after the call.',
  'Doing the work first and reporting afterwards is a failure in this mode even if the result would be correct.',
].join(' ');

const PLAN_MODE_RULE = [
  'HARD RULE, PLAN MODE.',
  'Write a real implementation plan as visible plain text: what you will do, in what order, what "done" looks like.',
  'You MAY look around (read, search, list).',
  'You MUST NOT create, edit or delete files, and MUST NOT run commands that change state.',
  'END YOUR TURN on the plan. Do not start carrying it out. The user will approve or ask to revise.',
  'Doing the work first is a failure in this mode even if the result would be correct.',
].join(' ');

const AUTO_PLAN_RUN_RULE = [
  'HARD RULE, PLANNING + BYPASS — THE USER HAS ANSWERED.',
  'Write a real implementation plan as visible plain text: what you will do, in what order, what "done" looks like.',
  'The plan MUST be visible before your first file-writing tool call — not inside thinking/reasoning.',
  'Do not stop to ask for approval of that plan — you have it. Do not come back with more questions.',
  'Then carry the plan out to the end in the SAME turn.',
  'Close with one finished result: the project is done, the user should check it.',
].join(' ');

// App-session ids waiting for the user's answers to the ask-phase questions.
const planBypassAwaitingAnswers = new Set();

const PLAN_BYPASS_LATCH_DIR = path.join(os.tmpdir(), 'neo3-plan-bypass');

function planBypassLatchPath(appSessionId) {
  return path.join(PLAN_BYPASS_LATCH_DIR, `${appSessionId}.latch`);
}

export function markGrokPlanBypassAwaitingAnswers(appSessionId) {
  const key = String(appSessionId || '');
  if (!key) {
    return;
  }
  planBypassAwaitingAnswers.add(key);
  try {
    fsSync.mkdirSync(PLAN_BYPASS_LATCH_DIR, { recursive: true });
    fsSync.writeFileSync(planBypassLatchPath(key), '1');
  } catch {
    /* best-effort: in-memory still works for this process */
  }
}

export function consumeGrokPlanBypassAwaitingAnswers(appSessionId) {
  const key = String(appSessionId || '');
  if (!key) {
    return false;
  }
  const inMemory = planBypassAwaitingAnswers.delete(key);
  let onDisk = false;
  try {
    const latch = planBypassLatchPath(key);
    onDisk = fsSync.existsSync(latch);
    if (onDisk) {
      fsSync.unlinkSync(latch);
    }
  } catch {
    /* ignore */
  }
  return inMemory || onDisk;
}

/**
 * Ask vs run for "plan + bypass".
 *
 * The composer one-shots the chip back to ordinary + bypass after the
 * first send, so the answering turn often arrives as `bypassPermissions`.
 * The latch is what still marks it as the run half — clicking the
 * question buttons uses resumeOptions (still planBypass), typing the
 * answer uses whatever is on the chip.
 */
export function resolveGrokPlanBypassPhase(permissionMode, appSessionId) {
  if (permissionMode === 'planBypass') {
    return consumeGrokPlanBypassAwaitingAnswers(appSessionId) ? 'run' : 'ask';
  }
  if (permissionMode === 'bypassPermissions' && consumeGrokPlanBypassAwaitingAnswers(appSessionId)) {
    return 'run';
  }
  return null;
}

export function resetGrokPlanBypassStateForTests() {
  planBypassAwaitingAnswers.clear();
}

/**
 * Builds the `--rules` payload: the extra system-prompt text for one run.
 *
 * Grok Build reads CLAUDE.md, skills and hooks by itself (harness compat), so
 * the only thing that has to be injected per run is what the composer's chips
 * mean — the work mode, and the plan half of `planBypass`. Same instructions
 * the Claude runtime appends (server/shared/work-mode.ts), so a mode behaves
 * the same on both engines. Exported for tests only.
 */
export function buildGrokRules({ workMode, permissionMode, model, planBypassPhase }) {
  const rules = [];
  if (permissionMode === 'planBypass' || planBypassPhase === 'run') {
    rules.push(planBypassPhase === 'run' ? AUTO_PLAN_RUN_RULE : AUTO_PLAN_ASK_RULE);
  }
  if (permissionMode === 'plan') {
    rules.push(PLAN_MODE_RULE);
  }
  // Preset rule includes identity (xAI always injects "You are Grok 4.6") plus
  // any mode-specific instructions (Heavy panel, …).
  const presetRule = resolveGrokModePreset(model)?.rule;
  if (presetRule) {
    rules.push(presetRule);
  } else if (model === 'grok-4.5' || model === 'grok-4.6') {
    // Raw model ids from old sessions / localStorage — still need an honest name.
    const name = model === 'grok-4.5' ? 'Grok 4.5' : 'Grok 4.6';
    rules.push(
      `MODEL IDENTITY: You are running as ${name} (CLI model id: ${model}). `
      + 'The built-in system line that says "You are Grok 4.6" is a product default — ignore it for self-identification. '
      + `When asked which model you are, answer "${name}".`,
    );
  }
  // 'grok' dialect: never name Claude's AskUserQuestion / Skill tool. Grok's
  // own ask_user_question is real; headless auto-answers it, Neo3 intercepts.
  const workModeText = workModeInstruction(workMode, permissionMode, 'grok');
  if (workModeText) {
    rules.push(workModeText);
  }
  // Interactive runs: when the model actually needs a choice, it must call
  // the tool (buttons) instead of writing "1. 2. 3." as chat text. Silent
  // bypass, the run half of planBypass, and unattended runs keep deciding.
  if (permissionMode !== 'bypassPermissions' && planBypassPhase !== 'run') {
    rules.push(
      'When you need the user to pick between options, call ask_user_question '
      + 'with concrete options (label plus a short description). Do not write the '
      + 'choices as numbered chat text — that skips the buttons. After calling it, stop; '
      + 'the next user message is their answer.',
    );
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

function runHookCommand({ command, timeoutMs, stdinJson }) {
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
      child.stdin?.write(JSON.stringify(stdinJson ?? {}));
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
 * Claude Stop hooks use `{decision:"block", reason}` to wake the agent for one
 * more turn (the vault reminder). Grok's CLI exits after `-p`, so we emulate
 * that by `--resume` with the reason — once, the hook's own sentinel file
 * (`/tmp/claude-mem-<session>`) stops a loop. Never fold the reason into
 * every UserPromptSubmit: that is the prompt-bloat path we refused on 22.08.
 */
export function parseStopHookDecision(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.decision === 'block' && typeof parsed.reason === 'string') {
      return parsed.reason.trim();
    }
  } catch {
    // Not control JSON — Stop hooks that only log (token-log) return nothing useful.
  }
  return '';
}

export async function collectGrokStopReason(sessionId) {
  if (process.platform === 'win32' || !sessionId) {
    return '';
  }
  for (const spec of readClaudeHookCommands('Stop')) {
    if (spec.command.includes('budget-hook')) {
      continue;
    }
    const reason = parseStopHookDecision(
      await runHookCommand({ ...spec, stdinJson: { session_id: sessionId } }),
    );
    if (reason) {
      return reason;
    }
  }
  return '';
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
export const SESSION_FOLLOWUP_OPEN_TAG = '<session_followup>';
export const SESSION_FOLLOWUP_CLOSE_TAG = '</session_followup>';

/**
 * Wraps a Stop-hook reason so history does not paint it as a user message
 * (same stripping as <work_mode_rules> in extractGrokUserTurn).
 */
export function embedGrokFollowupPrompt(reason) {
  return [
    SESSION_FOLLOWUP_OPEN_TAG,
    'This is an automatic follow-up from a session Stop hook, not a user message. Do not quote this tag.',
    'Ignore work-mode questions for this follow-up. If you write to memory, the chat must contain only that one memory line — never repeat the previous report.',
    String(reason || '').trim(),
    SESSION_FOLLOWUP_CLOSE_TAG,
  ].join('\n');
}

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
export function buildGrokArgs({ prompt, promptJson, promptFile, sessionId, resolvedSessionId, model, permissionMode, effort, workMode, hookContext, planBypassPhase }) {
  // `--output-format streaming-messages-json` is NDJSON in the Anthropic
  // Messages API wire format — the same {type: system|assistant|user|result}
  // envelope Claude Code emits, which is why the sessions provider can parse
  // it without a shim.
  const wirePermissionMode = resolveGrokPermissionMode(permissionMode);
  const rules = buildGrokRules({ workMode, permissionMode, model, planBypassPhase });
  // `--prompt-json`, `--prompt-file` and `-p` are mutually exclusive
  // (grok 1.0.5 argv). Image turns use ACP content blocks when they fit in
  // one argv; oversized prompts go through a temp file instead of E2BIG.
  const promptArgs = promptJson
    ? ['--prompt-json', promptJson]
    : promptFile
      ? ['--prompt-file', promptFile]
      : ['-p', flattenPromptForWindowsShell(embedGrokRulesInPrompt(prompt, rules, hookContext || ''))];
  const args = [
    ...promptArgs,
    '--output-format', 'streaming-messages-json',
    '--permission-mode', wirePermissionMode,
  ];

  // Plan mode must be read-only, but grok 1.0.5's own plan gate demonstrably
  // lets the FIRST file write through before cancelling the run (live run
  // 22.08 wrote the file it was told to plan). Both file-writing tools are
  // removed outright — `write` exists on the live toolset even though the
  // bundled README's 16-tool list predates it — so "plan" can never touch
  // the tree; the terminal is already gated by the CLI itself.
  // The ask half of planBypass uses the same denylist: analysis is allowed,
  // writes are not, until the user has answered the clarifying questions.
  if (permissionMode === 'plan' || (permissionMode === 'planBypass' && planBypassPhase !== 'run')) {
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
    const {
      sessionId,
      projectPath,
      cwd,
      model,
      permissionMode,
      effort,
      workMode,
      sessionSummary,
      meter,
      images,
      skipStopHooks,
      appSessionId,
    } = options;
    const workingDir = cwd || projectPath || process.cwd();
    const resolvedSessionId = sessionId || randomUUID();
    // New chats only: name the sidebar row from the first words of the prompt
    // so Dima sees Russian before Grok CLI writes its English auto-title.
    if (!sessionId) {
      maybeApplyGrokSessionTitle(appSessionId, command);
    }
    const processKey = resolvedSessionId;
    const imageDescriptors = normalizeImageDescriptors(images);
    let stdoutLineBuffer = '';
    let stderrBuffer = '';
    let terminalNotificationSent = false;
    let grokProcess = null;
    let sessionCreatedSent = false;
    let transientRetryAttempt = 0;
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;
    let lastAssistantText = '';
    let stopFollowupDone = false;
    let askedNativeQuestion = false;
    let pausedForQuestion = false;
    let attemptOverrides = {};
    let liveModel = model || null;
    let promptFileDir = null;
    const planBypassPhase = resolveGrokPlanBypassPhase(permissionMode, appSessionId);

    const emitGrokContextBudget = (existing = null) => {
      const fromDisk = readGrokContextBudget(workingDir, resolvedSessionId, liveModel);
      if (!fromDisk && !existing) {
        return;
      }
      const tokenBudget = {
        ...(existing && typeof existing === 'object' ? existing : {}),
        used: fromDisk?.used ?? existing?.used ?? 0,
        total: fromDisk?.total ?? existing?.total ?? 0,
        model: fromDisk?.model ?? existing?.model ?? liveModel,
      };
      if (!(Number(tokenBudget.used) > 0) && !(Number(tokenBudget.total) > 0)) {
        return;
      }
      try {
        ws.send(createNormalizedMessage({
          kind: 'status',
          text: 'token_budget',
          tokenBudget,
          sessionId: resolvedSessionId,
          provider: 'grok',
        }));
      } catch {
        /* socket may be mid-reconnect */
      }
    };

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

    const emitGrokQuestionPanel = (input) => {
      if (!appSessionId || stopFollowupDone || askedNativeQuestion) {
        return false;
      }
      askedNativeQuestion = true;
      const requestId = randomUUID();
      registerGrokQuestion({
        requestId,
        appSessionId: String(appSessionId),
        input,
        providerSessionId: resolvedSessionId,
        resumeOptions: {
          model,
          permissionMode,
          effort,
          workMode,
          cwd: workingDir,
          projectPath: projectPath || workingDir,
        },
      });
      if (planBypassPhase === 'ask') {
        markGrokPlanBypassAwaitingAnswers(appSessionId);
      }
      ws.send(createNormalizedMessage({
        kind: 'permission_request',
        requestId,
        toolName: 'AskUserQuestion',
        input,
        sessionId: resolvedSessionId,
        provider: 'grok',
      }));
      return true;
    };

    const stopGrokForQuestion = () => {
      if (pausedForQuestion) {
        return;
      }
      pausedForQuestion = true;
      const child = grokProcess;
      if (!child) {
        return;
      }
      const killGroup = (signal) => {
        if (child.pid && process.platform !== 'win32') {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch {
            /* group already gone */
          }
        }
        try {
          child.kill(signal);
        } catch {
          /* already dead */
        }
      };
      killGroup('SIGTERM');
    };

    const processGrokOutputLine = (line) => {
      if (pausedForQuestion || !line || !line.trim()) {
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
        // Usage rides on the raw Anthropic frames (assistant + result). The
        // normalized envelope has already dropped it, so the meter must see
        // the wire message. A metering bug must never kill the run.
        try {
          meter?.addMessage(response);
        } catch { /* ignore */ }
        const normalized = sessionsService.normalizeMessage('grok', response, resolvedSessionId);
        let sentBudget = false;
        for (const msg of normalized) {
          if (pausedForQuestion) {
            return;
          }
          if (msg.kind === 'text' && msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim()) {
            lastAssistantText = lastAssistantText
              ? `${lastAssistantText}\n${msg.content}`
              : msg.content;
          }
          if (msg.text === 'token_budget' && msg.tokenBudget) {
            const fromDisk = readGrokContextBudget(workingDir, resolvedSessionId, liveModel);
            if (fromDisk) {
              msg.tokenBudget = {
                ...msg.tokenBudget,
                used: fromDisk.used,
                total: fromDisk.total,
                model: fromDisk.model || msg.tokenBudget.model || liveModel,
              };
            }
            sentBudget = true;
          }
          const nativeQuestion = msg.kind === 'tool_use'
            && isGrokAskUserQuestionTool(msg.toolName)
            && fromGrokAskUserQuestionTool(msg.toolInput);
          const canOfferQuestion = Boolean(appSessionId)
            && !skipStopHooks
            && (permissionMode !== 'bypassPermissions' || planBypassPhase === 'ask');
          if (nativeQuestion && canOfferQuestion) {
            ws.send({
              ...msg,
              toolName: 'AskUserQuestion',
              toolInput: nativeQuestion,
            });
            emitGrokQuestionPanel(nativeQuestion);
            stopGrokForQuestion();
            return;
          }
          ws.send(msg);
        }
        if (!sentBudget && (response.type === 'assistant' || response.type === 'result')) {
          emitGrokContextBudget();
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
      liveModel = resolvedModel || liveModel;
      // Claude-side hooks (vault digest, real clock) — executed here because
      // Grok never runs them itself; best-effort, collected once per run.
      const hookContext = await collectGrokHookContext({ isNewSession: !sessionId }).catch(() => '');

      if (planBypassPhase === 'run' && appSessionId) {
        for (const pending of takeGrokQuestionsForAppSession(String(appSessionId))) {
          try {
            ws.send(createNormalizedMessage({
              kind: 'permission_cancelled',
              requestId: pending.requestId,
              sessionId: resolvedSessionId,
              provider: 'grok',
            }));
          } catch {
            /* socket may be mid-reconnect */
          }
        }
      }

      const maybeEmitGrokPlanExit = () => {
        if (permissionMode !== 'plan' || !appSessionId || stopFollowupDone) {
          return false;
        }
        const plan = String(lastAssistantText || '').trim();
        if (!plan) {
          return false;
        }
        const requestId = randomUUID();
        const input = { plan };
        registerGrokPlanExit({
          requestId,
          appSessionId: String(appSessionId),
          plan,
          resumeOptions: {
            model,
            permissionMode: 'plan',
            effort,
            workMode,
            cwd: workingDir,
            projectPath: projectPath || workingDir,
          },
        });
        ws.send(createNormalizedMessage({
          kind: 'tool_use',
          toolName: 'ExitPlanMode',
          toolInput: input,
          toolId: requestId,
          sessionId: resolvedSessionId,
          provider: 'grok',
        }));
        ws.send(createNormalizedMessage({
          kind: 'tool_result',
          toolName: 'ExitPlanMode',
          toolId: requestId,
          toolResult: { content: '', isError: false },
          sessionId: resolvedSessionId,
          provider: 'grok',
        }));
        ws.send(createNormalizedMessage({
          kind: 'permission_request',
          requestId,
          toolName: 'ExitPlanMode',
          input,
          sessionId: resolvedSessionId,
          provider: 'grok',
        }));
        return true;
      };

      const maybeEmitGrokQuestion = () => {
        if (!appSessionId || stopFollowupDone || askedNativeQuestion) {
          return false;
        }
        const parsed = parseGrokNumberedQuestion(lastAssistantText);
        if (!parsed) {
          return false;
        }
        return emitGrokQuestionPanel(toAskUserQuestionInput(parsed));
      };

      const startAttempt = (overrides = {}) => {
        attemptOverrides = overrides;
        void runAttempt(overrides).catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          await finishFailed(1, message);
        });
      };

      const runAttempt = async (overrides = {}) => {
        stdoutLineBuffer = '';
        stderrBuffer = '';
        lastAssistantText = '';

        // On a retry the very same session uuid is resumed if the first
        // attempt already materialized it on disk; otherwise the same `-s`
        // start is simply repeated — nothing was persisted the first time.
        const resumeId = overrides.forceResume
          ? resolvedSessionId
          : (sessionId
            || (transientRetryAttempt > 0 && grokSessionExistsOnDisk(workingDir, resolvedSessionId)
              ? resolvedSessionId
              : null));

        const attemptWorkMode = overrides.workMode ?? workMode;
        const attemptHookContext = Object.prototype.hasOwnProperty.call(overrides, 'hookContext')
          ? overrides.hookContext
          : hookContext;
        const attemptPrompt = overrides.prompt ?? command;
        const attemptImages = overrides.skipImages ? [] : imageDescriptors;

        // Sessions live under ~/.grok/sessions/<url-encoded cwd>/<uuid>/, so cwd
        // decides which project a session belongs to.
        const rules = buildGrokRules({
          workMode: attemptWorkMode,
          permissionMode,
          model: resolvedModel,
          planBypassPhase,
        });
        cleanupGrokPromptDir(promptFileDir);
        promptFileDir = null;
        let promptJson = null;
        let promptFile = null;
        const strippedPrompt = parseImagesInputTag(attemptPrompt).text;
        const embedded = embedGrokRulesInPrompt(strippedPrompt, rules, attemptHookContext || '');
        if (attemptImages.length > 0) {
          const withPaths = appendVisibleImagePathsTag(embedded, attemptImages);
          const blocks = await buildGrokUserContent(withPaths, attemptImages, workingDir);
          const json = JSON.stringify(blocks);
          if (blocks.some((block) => block.type === 'image') && grokPromptFitsArgv(json)) {
            promptJson = json;
          } else {
            const written = writeGrokPromptFile(appendImagesInputTag(embedded, attemptImages));
            promptFile = written.file;
            promptFileDir = written.dir;
          }
        } else if (!grokPromptFitsArgv(embedded)) {
          const written = writeGrokPromptFile(embedded);
          promptFile = written.file;
          promptFileDir = written.dir;
        }

        const args = buildGrokArgs({
          prompt: attemptPrompt,
          promptJson,
          promptFile,
          sessionId: resumeId,
          resolvedSessionId,
          model: resolvedModel,
          permissionMode,
          effort,
          workMode: attemptWorkMode,
          hookContext: attemptHookContext,
          planBypassPhase,
        });

        // Abort marks the run complete immediately, then SIGTERM. A queued
        // follow-up (or "ты походу повис") used to spawn --resume while the
        // old CLI still held chat_history.jsonl — the new process slept in
        // session_create with 0% CPU and the UI lied «Рассуждает».
        if (resumeId) {
          await ensurePreviousGrokRunDead(resumeId);
        }

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
        grokProcess.promptFileDir = promptFileDir;
        grokProcess.stdin.end();
        const spawnedAt = Date.now();
        let firstByteAt = null;
        let lastStdoutAt = null;

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

        // Long tool calls (bash, etc.) emit nothing on the Anthropic wire for
        // minutes. The browser stall watchdog reconnects after 30s of silence,
        // which makes the activity pill vanish even though the CLI is fine.
        // An empty status tick still moves lastFrameAt on the client without
        // rewriting the "Tools: …" label (handler ignores falsy text).
        const keepaliveTimer = setInterval(() => {
          if (grokProcess?.aborted || grokProcess?.hung || grokProcess?.killed || grokProcess?.exitCode !== null) {
            return;
          }
          const hangReason = grokHangReason({
            spawnedAt,
            firstByteAt,
            lastStdoutAt,
            now: Date.now(),
            hasChildren: grokHasDirectChildren(grokProcess.pid),
          });
          if (hangReason) {
            grokProcess.hung = true;
            grokProcess.hangReason = hangReason;
            killGrokProcessTree(grokProcess, 'SIGTERM');
            const hardKill = setTimeout(() => {
              if (grokProcess.exitCode === null && grokProcess.signalCode === null) {
                killGrokProcessTree(grokProcess, 'SIGKILL');
              }
            }, GROK_ABORT_TERM_MS);
            hardKill.unref?.();
            return;
          }
          try {
            ws.send(createNormalizedMessage({
              kind: 'status',
              text: '',
              sessionId: resolvedSessionId,
              provider: 'grok',
            }));
          } catch {
            /* socket may be mid-reconnect */
          }
          emitGrokContextBudget();
        }, 15_000);
        grokProcess.once('close', () => clearInterval(keepaliveTimer));
        grokProcess.once('error', () => clearInterval(keepaliveTimer));

        grokProcess.stdout.on('data', (data) => {
          const now = Date.now();
          if (firstByteAt == null) {
            firstByteAt = now;
          }
          lastStdoutAt = now;
          stdoutLineBuffer += data.toString();
          // A single tool_result JSON line (Suno, huge file reads) can grow
          // without a newline for minutes. Unbounded buffering OOMs the
          // process and looks like "the session died on the tool call".
          if (stdoutLineBuffer.length > MAX_GROK_STDOUT_LINE_CHARS && !stdoutLineBuffer.includes('\n')) {
            stdoutLineBuffer = '';
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: 'Grok вернул слишком большой кусок данных от инструмента. Пропускаю его, сессию не рву.',
              sessionId: resolvedSessionId,
              provider: 'grok',
            }));
            return;
          }
          const completeLines = stdoutLineBuffer.split(/\r?\n/);
          stdoutLineBuffer = completeLines.pop() || '';

          completeLines.forEach((line) => {
            if (pausedForQuestion) {
              return;
            }
            if (line.length > MAX_GROK_STDOUT_LINE_CHARS) {
              ws.send(createNormalizedMessage({
                kind: 'error',
                content: 'Grok вернул слишком большой кусок данных от инструмента. Пропускаю его, сессию не рву.',
                sessionId: resolvedSessionId,
                provider: 'grok',
              }));
              return;
            }
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
          cleanupGrokPromptDir(grokProcess.promptFileDir);
          releaseGrokProcess(processKey, grokProcess);

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

          if (grokProcess.hung) {
            await finishFailed(code ?? 1, grokHangUserMessage(grokProcess.hangReason));
            return;
          }

          if (pausedForQuestion) {
            if (!completeSent) {
              completeSent = true;
              ws.send(createCompleteMessage({ provider: 'grok', sessionId: resolvedSessionId, exitCode: 0 }));
            }
            recordRunOutcome(resolvedSessionId, { status: 'completed' });
            notifyTerminalState({ code: 0 });
            resolve();
            return;
          }

          if (code === 0) {
            if (!completeSent) {
              // A numbered question is a pause for the user, not the end of
              // the session — skip the Stop/memory follow-up so the reminder
              // does not land on top of the buttons.
              const offeredPlan = !skipStopHooks && maybeEmitGrokPlanExit();
              const askedQuestion = !offeredPlan && !skipStopHooks && maybeEmitGrokQuestion();
              if (!offeredPlan && !askedQuestion && !skipStopHooks && !stopFollowupDone) {
                const reason = await collectGrokStopReason(resolvedSessionId).catch(() => '');
                if (reason) {
                  stopFollowupDone = true;
                  startAttempt({
                    prompt: embedGrokFollowupPrompt(reason),
                    skipImages: true,
                    hookContext: '',
                    workMode: 'autopilot',
                    forceResume: true,
                  });
                  return;
                }
              }
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
              releaseGrokProcess(processKey, retryStub);
              finishAborted();
              return;
            }

            startAttempt(attemptOverrides);
            return;
          }

          await finishFailed(code, failureReason);
        });

        grokProcess.on('error', async (error) => {
          cleanupGrokPromptDir(grokProcess.promptFileDir);
          releaseGrokProcess(processKey, grokProcess);

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

async function abortGrokSession(sessionId) {
  const child = activeGrokProcesses.get(sessionId);
  if (!child) {
    await killOrphanGrokPids(sessionId);
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  child.aborted = true;

  // Kill the WHOLE TREE, not just the CLI. Two layers because the CLI's bash
  // wrappers start their own sessions (measured 22.08: after a group kill the
  // wrapper reparented to init and its `sleep 120` lived on).
  killGrokProcessTree(child, 'SIGTERM');
  const pid = child.pid;
  // Drop the map slot so a follow-up send can register the next process —
  // but WAIT until this pid is actually gone, otherwise --resume sleeps on
  // the session files the dying CLI still holds.
  releaseGrokProcess(sessionId, child);

  if (pid) {
    const gone = await waitForPidExit(pid, GROK_ABORT_TERM_MS);
    if (!gone) {
      killGrokProcessTree(child, 'SIGKILL');
      await waitForPidExit(pid, GROK_ABORT_KILL_MS);
    }
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      // retry-wait stub, already cancelled
    }
  }
  await killOrphanGrokPids(sessionId);
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

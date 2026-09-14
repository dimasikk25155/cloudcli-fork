/**
 * Work modes: how much the agent checks in with the user while it works.
 *
 * This is deliberately NOT the same axis as `permissionMode` (which decides
 * whether a tool call needs an OK). A run can be fully permitted and still be
 * required to stop and brief the user between stages — or be permission-gated
 * yet expected to plough through without conversation.
 *
 * The instruction is injected as a system-prompt append (see
 * mapCliOptionsToSDK in server/claude-sdk.js), never as prompt text, so it
 * cannot leak into the persisted chat history the user reads back.
 */

export const WORK_MODES = ['autopilot', 'checkpoints', 'interrogate', 'build'] as const;

export type WorkMode = (typeof WORK_MODES)[number];

/** The mode a run uses when the client sends nothing (unchanged behaviour). */
export const DEFAULT_WORK_MODE: WorkMode = 'autopilot';

export const WORK_MODE_DIALECTS = ['claude', 'grok'] as const;

export type WorkModeDialect = (typeof WORK_MODE_DIALECTS)[number];

/** Engines that were never taught a dialect keep Claude's wording. */
export const DEFAULT_WORK_MODE_DIALECT: WorkModeDialect = 'claude';

/**
 * The only sentences that differ between engines: how a mode asks a question,
 * and how it reaches the autopilot skill.
 *
 * Naming a tool the engine does not have is not a harmless mismatch — it is an
 * instruction to walk through a door that isn't there. Grok Build 1.0.5 has
 * no Skill tool (skills are picked up by description or `/name`). It DOES have
 * `ask_user_question` (live toolset, not the README's 16-tool table). Headless
 * `-p` auto-answers that tool with "no user available"; Neo3 intercepts the
 * call, draws Claude's button panel, and resumes with the click. So Grok is
 * told to call `ask_user_question`, never the Claude name `AskUserQuestion`.
 */
const DIALECTS: Record<WorkModeDialect, {
  askAtFork: string;
  askBeforeStep: string;
  invokeAutopilot: string;
  /**
   * Extra hard-stop lines appended to checkpoints/interrogate. Empty for
   * Claude (its wording must not change by a byte); on Grok they exist because
   * the smaller models (grok-4.5 at low effort) demonstrably blow straight
   * through the polite phrasing: live run 22.08 created the file and answered
   * «Готово» instead of stopping with the plan.
   */
  checkpointsHardStop: string;
  interrogateHardStop: string;
}> = {
  claude: {
    askAtFork:
      'ask with AskUserQuestion, and make the options the actual variants at stake'
      + ' (approaches, trade-offs, business choices) — never a bare "continue" / "adjust the plan".',
    askBeforeStep:
      'ask the user clarifying questions with AskUserQuestion, offering concrete options rather than open prose.',
    invokeAutopilot:
      'Invoke the Skill tool with skill "autopilot" and hand it that message verbatim as the brief.',
    checkpointsHardStop: '',
    interrogateHardStop: '',
  },
  grok: {
    askAtFork:
      'call ask_user_question, and make the options the actual variants at stake'
      + ' (approaches, trade-offs, business choices) — never a bare "continue" / "adjust the plan".'
      + ' Do not write the options as numbered chat text.',
    askBeforeStep:
      'ask the user clarifying questions with ask_user_question, offering concrete options rather than open prose.'
      + ' Do not write the options as numbered chat text.',
    invokeAutopilot:
      'Run the `autopilot` skill and hand it that message verbatim as the brief — your harness discovers it as `autopilot`.'
      + ' If you cannot invoke a skill as a tool, read ~/.claude/skills/autopilot/SKILL.md with read_file and follow it to the letter,'
      + ' including every phase file it tells you to open next.',
    checkpointsHardStop:
      'HARD RULE, no exceptions: on a new task your VERY FIRST output is the numbered stage plan as visible'
      + ' plain text — zero tool calls before it. Briefs between stages are narration, not questions:'
      + ' keep working through the stages in the same turn and never end a turn just to ask whether to continue.',
    interrogateHardStop:
      'HARD RULE, no exceptions: on a new task your VERY FIRST action is ask_user_question with concrete options,'
      + ' and you STOP after calling it — zero file writes or shell commands that change anything before the user answers.'
      + ' Doing the work first and reporting afterwards is a failure in this mode even if the result would be correct.',
  },
};

function workModeInstructions(dialect: WorkModeDialect): Record<WorkMode, string> {
  const phrases = DIALECTS[dialect];

  return {
    // Autopilot is the product's historical behaviour, so it stays empty: no
    // extra tokens, no nudge that could fight the base system prompt.
    autopilot: '',

    // «Брифы» = видимый ход работы, а не забор из разрешений. Первая версия
    // после каждой стадии спрашивала «продолжать?» — Дима прокликал пять
    // одинаковых кнопок подряд и справедливо взбесился (23.08). Теперь бриф —
    // это нарратив, агент едет дальше сам, а вопрос задаёт только там, где
    // выбор реально за пользователем.
    checkpoints: [
      'WORK MODE: STAGED BRIEFINGS.',
      'Split the task into named stages before touching anything, and post that numbered plan first.',
      'Work through the stages in order. At the end of every stage post a short brief:',
      'what you did, what you found, what is next. Keep it to a few lines — no wall of text, no code dumps.',
      'Then continue into the next stage YOURSELF, immediately. Never ask permission to continue',
      'and never pose a question whose options amount to "continue" / "adjust the plan" —',
      'making the user click through approvals is this mode\'s one failure pattern.',
      'Stop and ask ONLY at a genuine fork: a business decision, an irreversible or risky step,',
      `or several defensible options where the choice belongs to the user. There, ${phrases.askAtFork}`,
      'If a stage turns out bigger than planned, say so in its brief instead of quietly absorbing it.',
      'Close the task with a compact summary across all stages.',
      ...(phrases.checkpointsHardStop ? [phrases.checkpointsHardStop] : []),
    ].join(' '),

    interrogate: [
      'WORK MODE: CONFIRM EVERYTHING.',
      'Assume nothing. Before you start any piece of work — and before each significant step inside it —',
      phrases.askBeforeStep,
      'State the assumption you would otherwise have made and let the user correct it.',
      'Where several reasonable readings of the request exist, list them and ask which one is meant;',
      'never pick one yourself to keep moving. Get an explicit go-ahead before writing files,',
      'running commands that change state, or moving on to the next step.',
      'Reporting back after the fact does not replace asking first.',
      ...(phrases.interrogateHardStop ? [phrases.interrogateHardStop] : []),
    ].join(' '),

    // Собрать проект целиком за один прогон, а не за четыре сессии с хэндофами.
    // Инструкция не описывает процесс — его целиком держит скилл; она лишь
    // отдаёт ему сообщение как бриф и решает, спрашивать ли пользователя.
    build: [
      'WORK MODE: AUTOPILOT.',
      "The user's message is a brief for the `autopilot` skill, not an ordinary chat turn.",
      phrases.invokeAutopilot,
      'Do not scope, plan or start building on your own beforehand: the skill owns the whole flight —',
      'the numbered requirements manifest, questions only at genuine forks, the spec, the tickets,',
      'the parallel subagents and the blind acceptance against the brief.',
      'If `.autopilot/` already holds an unfinished run, continue that one instead of starting another.',
      'A message that is plainly not a build request — a greeting, a question, a one-line fix —',
      'is answered normally, without the skill.',
    ].join(' '),
  };
}

/**
 * Автопилот спрашивает ровно столько, сколько позволяют права прогона.
 *
 * Дима формулирует это одной фразой: «планирование плюс обход — значит
 * автопилот, но вопросов мне не задаёшь». Обход прав и есть заявка на полный
 * автомат; во всех остальных режимах вопросы на развилках остаются.
 */
const BYPASS_PERMISSION_MODES = new Set(['bypassPermissions', 'planBypass']);

function autopilotDial(permissionMode: unknown): string {
  return BYPASS_PERMISSION_MODES.has(String(permissionMode))
    ? 'Run it in `full` mode: decide the forks yourself and record them as assumptions, ask nothing.'
    : 'Run it in `semi` mode: ask only where the brief leaves a real fork open.';
}

/** Narrows an untrusted client value to a known mode. */
export function normalizeWorkMode(value: unknown): WorkMode {
  return WORK_MODES.includes(value as WorkMode) ? (value as WorkMode) : DEFAULT_WORK_MODE;
}

/** Narrows a caller-supplied dialect; anything unknown speaks Claude. */
export function normalizeWorkModeDialect(value: unknown): WorkModeDialect {
  return WORK_MODE_DIALECTS.includes(value as WorkModeDialect)
    ? (value as WorkModeDialect)
    : DEFAULT_WORK_MODE_DIALECT;
}

/**
 * The system-prompt text for a mode, or null when the mode needs none
 * (autopilot) — callers use null to skip the append entirely.
 */
export function workModeInstruction(
  value: unknown,
  permissionMode?: unknown,
  dialect: unknown = DEFAULT_WORK_MODE_DIALECT,
): string | null {
  const mode = normalizeWorkMode(value);
  const text = workModeInstructions(normalizeWorkModeDialect(dialect))[mode] || null;
  if (!text || mode !== 'build') {
    return text;
  }
  return `${text} ${autopilotDial(permissionMode)}`;
}

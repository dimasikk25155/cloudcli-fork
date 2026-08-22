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
 * instruction to walk through a door that isn't there. Measured on Grok Build
 * 1.0.5 (`~/.grok/README.md`, "Built-in Tools"): its 16 built-in tools are
 * read_file, search_replace, grep_search, list_dir, bash, web_search,
 * web_fetch, todo_write, task, kill_task, get_task_output, memory_search,
 * memory_get, search_tool, use_tool, lsp. There is **no AskUserQuestion and no
 * Skill tool** — Grok picks skills up from their description or a `/name`
 * mention, and it has no way to render option buttons at all.
 *
 * So on Grok a question is "end the turn with the question written out", which
 * is exactly what a headless single-turn run does anyway: the user answers in
 * the next turn via --resume.
 */
const DIALECTS: Record<WorkModeDialect, {
  askBetweenStages: string;
  askBeforeStep: string;
  invokeAutopilot: string;
}> = {
  claude: {
    askBetweenStages:
      'ask with AskUserQuestion (options along the lines of "continue" / "adjust the plan").',
    askBeforeStep:
      'ask the user clarifying questions with AskUserQuestion, offering concrete options rather than open prose.',
    invokeAutopilot:
      'Invoke the Skill tool with skill "autopilot" and hand it that message verbatim as the brief.',
  },
  grok: {
    askBetweenStages:
      'write the question out as plain text with numbered options ("1 — continue" / "2 — adjust the plan")'
      + ' and end your turn on it. You have no tool for asking, so ending the turn IS the question;'
      + ' a question you keep working past is not a question.',
    askBeforeStep:
      'ask the user clarifying questions as plain text with numbered options rather than open prose,'
      + ' and end your turn on the question. You have no tool for asking, so a question you do not stop after is not a question.',
    invokeAutopilot:
      'Run the `autopilot` skill and hand it that message verbatim as the brief — your harness discovers it as `autopilot`.'
      + ' If you cannot invoke a skill as a tool, read ~/.claude/skills/autopilot/SKILL.md with read_file and follow it to the letter,'
      + ' including every phase file it tells you to open next.',
  },
};

function workModeInstructions(dialect: WorkModeDialect): Record<WorkMode, string> {
  const phrases = DIALECTS[dialect];

  return {
    // Autopilot is the product's historical behaviour, so it stays empty: no
    // extra tokens, no nudge that could fight the base system prompt.
    autopilot: '',

    checkpoints: [
      'WORK MODE: STAGED BRIEFINGS.',
      'Split the task into named stages before touching anything, and post that numbered plan first.',
      'Work through one stage at a time. At the end of every stage, stop and post a short brief:',
      'what you did, what you found, what is next. Keep it to a few lines — no wall of text, no code dumps.',
      `Then wait for the user before starting the next stage: ${phrases.askBetweenStages}`,
      'Do not chain stages together silently.',
      'If a stage turns out bigger than planned, say so in the brief instead of quietly absorbing it.',
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

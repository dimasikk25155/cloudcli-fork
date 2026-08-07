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

export const WORK_MODES = ['autopilot', 'checkpoints', 'interrogate'] as const;

export type WorkMode = (typeof WORK_MODES)[number];

/** The mode a run uses when the client sends nothing (unchanged behaviour). */
export const DEFAULT_WORK_MODE: WorkMode = 'autopilot';

const WORK_MODE_INSTRUCTIONS: Record<WorkMode, string> = {
  // Autopilot is the product's historical behaviour, so it stays empty: no
  // extra tokens, no nudge that could fight the base system prompt.
  autopilot: '',

  checkpoints: [
    'WORK MODE: STAGED BRIEFINGS.',
    'Split the task into named stages before touching anything, and post that numbered plan first.',
    'Work through one stage at a time. At the end of every stage, stop and post a short brief:',
    'what you did, what you found, what is next. Keep it to a few lines — no wall of text, no code dumps.',
    'Then wait for the user before starting the next stage: ask with AskUserQuestion',
    '(options along the lines of "continue" / "adjust the plan"). Do not chain stages together silently.',
    'If a stage turns out bigger than planned, say so in the brief instead of quietly absorbing it.',
  ].join(' '),

  interrogate: [
    'WORK MODE: CONFIRM EVERYTHING.',
    'Assume nothing. Before you start any piece of work — and before each significant step inside it —',
    'ask the user clarifying questions with AskUserQuestion, offering concrete options rather than open prose.',
    'State the assumption you would otherwise have made and let the user correct it.',
    'Where several reasonable readings of the request exist, list them and ask which one is meant;',
    'never pick one yourself to keep moving. Get an explicit go-ahead before writing files,',
    'running commands that change state, or moving on to the next step.',
    'Reporting back after the fact does not replace asking first.',
  ].join(' '),
};

/** Narrows an untrusted client value to a known mode. */
export function normalizeWorkMode(value: unknown): WorkMode {
  return WORK_MODES.includes(value as WorkMode) ? (value as WorkMode) : DEFAULT_WORK_MODE;
}

/**
 * The system-prompt text for a mode, or null when the mode needs none
 * (autopilot) — callers use null to skip the append entirely.
 */
export function workModeInstruction(value: unknown): string | null {
  return WORK_MODE_INSTRUCTIONS[normalizeWorkMode(value)] || null;
}

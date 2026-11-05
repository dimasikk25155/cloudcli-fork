/**
 * The role of a Neo3 agent travels as a hidden `<agent_brief>` block in the
 * first message of its chat (thread, queue item, schedule run) — not as a
 * system prompt of one engine, so Claude, Codex and Grok get it the same way.
 * `stripAgentOnlyBlocks` removes the block wherever a person reads the text.
 *
 * Files are named by path only («прочитай перед работой»): their contents
 * would swell every message. No database here — client and server import it.
 */

export type AgentBriefInput = {
  name: string;
  role: string;
  /** «Проверка результата»: self-check rules; empty → no verdict demand. */
  checks: string;
  files: string[];
  /** Live rules of the agent's memory, in order. */
  rules: { text: string }[];
  /** Current memory version (Vn). */
  rulesVersion: number;
};

/** A text inside the block must not open or close it. */
function inert(text: string): string {
  return String(text ?? '').replace(/<\/?agent_brief>/gi, '').trim();
}

export function buildAgentBrief(input: AgentBriefInput): string {
  const name = inert(input.name);
  const sections: string[] = [
    `Ты — агент «${name}». Держись этой роли весь чат.`,
    `Роль:\n${inert(input.role)}`,
  ];

  const checks = inert(input.checks);
  if (checks) {
    sections.push(
      `Проверка результата: перед ответом проверь свою работу по этим правилам:\n${checks}\n`
      + 'В конце ответа — отдельная строка «ВЕРДИКТ: OK» или «ВЕРДИКТ: FAIL — причина».',
    );
  }

  const files = (input.files ?? []).map(inert).filter(Boolean);
  if (files.length > 0) {
    sections.push(`Прочитай перед работой:\n${files.map((file) => `- ${file}`).join('\n')}`);
  }

  const rules = (input.rules ?? []).map((rule) => inert(rule.text)).filter(Boolean);
  if (rules.length > 0) {
    sections.push(`Правила (V${input.rulesVersion}):\n${rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`);
  }

  sections.push('Новое правило на будущее (урок этого чата) — workspace_action agent.remember {text}.');
  return `<agent_brief>\n${sections.join('\n\n')}\n</agent_brief>`;
}

/** The block, then the task — what the engine receives. */
export function withAgentBrief(brief: string, text: string): string {
  return brief ? `${brief}\n\n${text}` : text;
}

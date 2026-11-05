/** Метка у чата агента в сайдбаре: «агент: <имя>»; у обычного чата — null. */
export function agentLabel(agentName: unknown): string | null {
  const name = typeof agentName === 'string' ? agentName.trim() : '';
  return name ? `агент: ${name}` : null;
}

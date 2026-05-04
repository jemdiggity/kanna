export function encodeDaemonInput(input: string): number[] {
  return Array.from(new TextEncoder().encode(input));
}

interface AgentStageInputOptions {
  agentProvider: string | null | undefined;
  kittyKeyboard: boolean;
}

export function encodeAgentStageInput(
  stagePrompt: string,
  options: AgentStageInputOptions,
): number[] {
  const submit = options.agentProvider === "claude" && options.kittyKeyboard ? "\x1b[13u" : "\r";
  return encodeDaemonInput(`\x1b[200~${stagePrompt}\x1b[201~${submit}`);
}

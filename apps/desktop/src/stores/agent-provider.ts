import type { AgentProvider } from "@kanna/db";

export interface AgentProviderAvailability {
  claude: boolean;
  copilot: boolean;
  codex: boolean;
}

export function normalizeAgentProviderCandidates(
  providers: AgentProvider | AgentProvider[] | undefined,
): AgentProvider[] {
  if (!providers) return [];
  return Array.isArray(providers) ? providers : [providers];
}

export function resolveAgentProvider(
  providers: AgentProvider | AgentProvider[] | undefined,
  availability: AgentProviderAvailability,
): AgentProvider {
  const candidates = normalizeAgentProviderCandidates(providers);
  if (candidates.length === 0) {
    throw new Error("No agent provider configured for this task or stage.");
  }

  for (const provider of candidates) {
    if (availability[provider]) return provider;
  }

  throw new Error(`None of the configured agent providers are available: ${candidates.join(", ")}.`);
}

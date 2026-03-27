import type { AgentDefinition } from "./pipeline-types";
import { parseFrontmatter } from "../config/custom-tasks";

const VALID_PERMISSION_MODES = ["default", "acceptEdits", "dontAsk"] as const;

export function parseAgentDefinition(content: string): AgentDefinition {
  const { frontmatter, body } = parseFrontmatter(content);

  const fm: Record<string, unknown> = frontmatter ?? {};
  const prompt = body.trim();

  const def: AgentDefinition = {
    name: typeof fm.name === "string" ? fm.name : "",
    description: typeof fm.description === "string" ? fm.description : "",
    prompt,
  };

  if (typeof fm.model === "string") {
    def.model = fm.model;
  }

  if (typeof fm.permission_mode === "string") {
    def.permission_mode = fm.permission_mode as AgentDefinition["permission_mode"];
  }

  if (Array.isArray(fm.allowed_tools) && fm.allowed_tools.every((t: unknown) => typeof t === "string")) {
    def.allowed_tools = fm.allowed_tools as string[];
  }

  // agent_provider: YAML array, single string, or comma-separated string
  if (Array.isArray(fm.agent_provider) && fm.agent_provider.every((v: unknown) => typeof v === "string")) {
    def.agent_provider = fm.agent_provider as string[];
  } else if (typeof fm.agent_provider === "string") {
    if (fm.agent_provider.includes(",")) {
      def.agent_provider = fm.agent_provider.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    } else {
      def.agent_provider = [fm.agent_provider.trim()];
    }
  }

  const errors = validateAgentDefinition(def);
  if (errors.length > 0) {
    throw new Error(`Invalid AGENT.md: ${errors.join("; ")}`);
  }

  return def;
}

export function validateAgentDefinition(def: AgentDefinition): string[] {
  const errors: string[] = [];

  if (typeof def.name !== "string" || def.name.trim() === "") {
    errors.push("name is required and must be a non-empty string");
  }

  if (typeof def.description !== "string" || def.description.trim() === "") {
    errors.push("description is required and must be a non-empty string");
  }

  if (typeof def.prompt !== "string" || def.prompt.trim() === "") {
    errors.push("prompt (AGENT.md body) must be non-empty");
  }

  if (
    def.permission_mode !== undefined &&
    !(VALID_PERMISSION_MODES as readonly string[]).includes(def.permission_mode)
  ) {
    errors.push(
      `permission_mode must be one of: ${VALID_PERMISSION_MODES.join(", ")} (got "${def.permission_mode}")`
    );
  }

  return errors;
}

import { parse } from "smol-toml";
import type { KannaConfig, TasksConfig, TeamConfig, AgentConfig } from "./types.js";

export function parseKannaConfig(toml: string): KannaConfig {
  const raw = parse(toml) as Record<string, unknown>;

  const config: KannaConfig = {};

  if (raw.tasks && typeof raw.tasks === "object") {
    const t = raw.tasks as Record<string, unknown>;
    const tasks: TasksConfig = {};
    if (typeof t.auto_assign === "boolean") tasks.auto_assign = t.auto_assign;
    if (Array.isArray(t.labels)) tasks.labels = t.labels as string[];
    if (typeof t.branch_prefix === "string") tasks.branch_prefix = t.branch_prefix;
    config.tasks = tasks;
  }

  if (raw.team && typeof raw.team === "object") {
    const t = raw.team as Record<string, unknown>;
    const team: TeamConfig = {};
    if (typeof t.slack_channel === "string") team.slack_channel = t.slack_channel;
    if (typeof t.discord_channel === "string") team.discord_channel = t.discord_channel;
    if (typeof t.notify_on_pr === "boolean") team.notify_on_pr = t.notify_on_pr;
    if (typeof t.notify_on_merge === "boolean") team.notify_on_merge = t.notify_on_merge;
    config.team = team;
  }

  if (raw.agents && typeof raw.agents === "object") {
    const rawAgents = raw.agents as Record<string, unknown>;
    const agents: Record<string, AgentConfig> = {};
    for (const [name, value] of Object.entries(rawAgents)) {
      if (value && typeof value === "object") {
        const a = value as Record<string, unknown>;
        const agent: AgentConfig = {};
        if (typeof a.enabled === "boolean") agent.enabled = a.enabled;
        if (typeof a.model === "string") agent.model = a.model;
        if (typeof a.max_tokens === "number") agent.max_tokens = a.max_tokens;
        agents[name] = agent;
      }
    }
    config.agents = agents;
  }

  return config;
}

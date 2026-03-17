export interface AgentConfig {
  enabled?: boolean;
  model?: string;
  max_tokens?: number;
}

export interface TasksConfig {
  auto_assign?: boolean;
  labels?: string[];
  branch_prefix?: string;
}

export interface TeamConfig {
  slack_channel?: string;
  discord_channel?: string;
  notify_on_pr?: boolean;
  notify_on_merge?: boolean;
}

export interface KannaConfig {
  tasks?: TasksConfig;
  team?: TeamConfig;
  agents?: Record<string, AgentConfig>;
}

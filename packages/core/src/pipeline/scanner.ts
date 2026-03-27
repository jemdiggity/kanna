import type { AgentDefinition, PipelineDefinition } from "./pipeline-types";
import { parseAgentDefinition } from "./agent-loader";
import { parsePipelineJson } from "./pipeline-loader";
import { getBuiltInAgents, getBuiltInPipelines } from "./built-in";

// Function types matching Tauri's file commands
type ReadFileFn = (path: string) => Promise<string>;
type ListDirFn = (path: string) => Promise<string[]>;

export interface ScanResult {
  agents: AgentDefinition[];
  pipelines: PipelineDefinition[];
  errors: string[];
}

export async function scanAgentsAndPipelines(
  repoPath: string,
  readFile: ReadFileFn,
  listDir: ListDirFn,
): Promise<ScanResult> {
  const result: ScanResult = { agents: [], pipelines: [], errors: [] };

  // Scan agents from {repoPath}/.kanna/agents/*/AGENT.md
  const agentsDir = `${repoPath}/.kanna/agents`;
  let agentDirs: string[];
  try {
    agentDirs = await listDir(agentsDir);
  } catch {
    agentDirs = [];
  }

  for (const dir of agentDirs) {
    const agentMdPath = `${agentsDir}/${dir}/AGENT.md`;
    let content: string;
    try {
      content = await readFile(agentMdPath);
    } catch {
      // No AGENT.md in this directory — silently skip
      continue;
    }

    try {
      const agent = parseAgentDefinition(content);
      result.agents.push(agent);
    } catch (err) {
      result.errors.push(
        `Failed to parse agent at ${agentMdPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Scan pipelines from {repoPath}/.kanna/pipelines/*.json
  const pipelinesDir = `${repoPath}/.kanna/pipelines`;
  let pipelineFiles: string[];
  try {
    pipelineFiles = await listDir(pipelinesDir);
  } catch {
    pipelineFiles = [];
  }

  for (const file of pipelineFiles) {
    if (!file.endsWith(".json")) continue;

    const filePath = `${pipelinesDir}/${file}`;
    let content: string;
    try {
      content = await readFile(filePath);
    } catch {
      result.errors.push(`Failed to read pipeline file ${filePath}`);
      continue;
    }

    try {
      const pipeline = parsePipelineJson(content);
      result.pipelines.push(pipeline);
    } catch (err) {
      result.errors.push(
        `Failed to parse pipeline at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Merge built-in defaults — repo files override built-ins by name
  const repoAgentNames = new Set(result.agents.map((a) => a.name));
  for (const builtIn of getBuiltInAgents()) {
    if (!repoAgentNames.has(builtIn.name)) {
      result.agents.push(builtIn);
    }
  }

  const repoPipelineNames = new Set(result.pipelines.map((p) => p.name));
  for (const builtIn of getBuiltInPipelines()) {
    if (!repoPipelineNames.has(builtIn.name)) {
      result.pipelines.push(builtIn);
    }
  }

  return result;
}

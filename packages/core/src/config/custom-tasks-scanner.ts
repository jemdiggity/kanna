import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { parseAgentMd, parseFrontmatter, type CustomTaskScanResult } from "./custom-tasks.js";

/**
 * Returns true if the content has a non-whitespace prompt body
 * or an agent reference in frontmatter.
 * Used by scanCustomTasks to distinguish "empty/no-body" (silent skip)
 * from "malformed YAML" (reported as error) when parseAgentMd returns null.
 */
function hasPromptBody(content: string): boolean {
  if (!content || !content.trim()) {
    return false;
  }

  const { frontmatter, body } = parseFrontmatter(content);
  if (frontmatter === undefined) {
    return true;
  }

  return body.trim().length > 0 || (typeof frontmatter?.agent === "string" && frontmatter.agent.trim().length > 0);
}

export async function scanCustomTasks(
  repoPath: string,
  signal?: AbortSignal,
): Promise<CustomTaskScanResult> {
  const result: CustomTaskScanResult = { tasks: [], errors: [] };
  const tasksDir = join(repoPath, ".kanna", "tasks");

  if (signal?.aborted) return result;

  let entries: string[];
  try {
    entries = await readdir(tasksDir);
  } catch {
    return result; // Directory doesn't exist
  }

  for (const entry of entries) {
    if (signal?.aborted) return { tasks: [], errors: [] };

    const entryPath = join(tasksDir, entry);
    try {
      const entryStat = await stat(entryPath);
      if (!entryStat.isDirectory()) continue;
    } catch {
      continue;
    }

    const agentMdPath = join(entryPath, "agent.md");
    let content: string;
    try {
      content = await readFile(agentMdPath, "utf-8");
    } catch {
      continue; // No agent.md in this directory
    }

    // Skip files with no meaningful body content silently.
    // An agent.md with valid frontmatter but no prompt is not an error —
    // it's just an incomplete/placeholder file.
    if (!hasPromptBody(content)) {
      continue;
    }

    const config = parseAgentMd(content, entry);
    if (config) {
      result.tasks.push(config);
    } else {
      result.errors.push({
        path: agentMdPath,
        error: "Failed to parse agent.md (malformed YAML)",
      });
    }
  }

  return result;
}

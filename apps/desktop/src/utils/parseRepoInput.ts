export interface ParsedInput {
  type: "clone" | "local" | "unknown";
  owner?: string;
  repo?: string;
  cloneUrl?: string;
  localPath?: string;
}

export function parseRepoInput(input: string): ParsedInput {
  const trimmed = input.trim();
  if (!trimmed) return { type: "unknown" };

  // Local path
  if (trimmed.startsWith("/") || trimmed.startsWith("~")) {
    return { type: "local", localPath: trimmed };
  }

  // gh repo clone command
  if (trimmed.startsWith("gh repo clone ")) {
    const remainder = trimmed.slice("gh repo clone ".length).trim();
    return parseShorthand(remainder);
  }

  // SSH URL
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return { type: "clone", owner: sshMatch[1], repo: sshMatch[2], cloneUrl: trimmed };
  }

  // HTTPS URL
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { type: "clone", owner: httpsMatch[1], repo: httpsMatch[2], cloneUrl: `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}.git` };
  }

  // Shorthand: owner/repo (exactly two segments, no spaces)
  return parseShorthand(trimmed);
}

function parseShorthand(input: string): ParsedInput {
  const match = input.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (match) {
    return { type: "clone", owner: match[1], repo: match[2], cloneUrl: `https://github.com/${match[1]}/${match[2]}.git` };
  }
  return { type: "unknown" };
}

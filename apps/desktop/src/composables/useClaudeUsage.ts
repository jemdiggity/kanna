import { ref } from "vue";
import { invoke } from "../invoke";

export interface UsageSection {
  name: string;
  percent: number;
  resetTime: string;
  spent?: string;
}

export interface ClaudeUsage {
  session: UsageSection | null;
  weekAll: UsageSection | null;
  weekSonnet: UsageSection | null;
  extra: UsageSection | null;
}

const SECTION_KEYS = [
  { key: "session" as const, header: "Current session" },
  { key: "weekAll" as const, header: "Current week (all models)" },
  { key: "weekSonnet" as const, header: "Current week (Sonnet only)" },
  { key: "extra" as const, header: "Extra usage" },
];

export function parseClaudeUsage(raw: string): ClaudeUsage {
  const result: ClaudeUsage = {
    session: null,
    weekAll: null,
    weekSonnet: null,
    extra: null,
  };

  for (const { key, header } of SECTION_KEYS) {
    const headerIdx = raw.indexOf(header);
    if (headerIdx === -1) continue;

    const afterHeader = raw.substring(headerIdx + header.length);
    // Limit search to a reasonable window to avoid matching the wrong section
    const window = afterHeader.substring(0, 300);

    const percentMatch = window.match(/(\d+)%\s*used/);
    if (!percentMatch) continue;

    const resetMatch = window.match(/Resets?\s+([^$\n]*?\([^)]+\))/);
    const spentMatch = window.match(/\$([\d.]+)\s*\/\s*\$([\d.]+)\s*spent/);

    result[key] = {
      name: header,
      percent: parseInt(percentMatch[1], 10),
      resetTime: resetMatch ? resetMatch[1].trim() : "",
      ...(spentMatch ? { spent: `$${spentMatch[1]} / $${spentMatch[2]}` } : {}),
    };
  }

  return result;
}

const usage = ref<ClaudeUsage | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function fetchUsage(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const raw = await invoke<string>("get_claude_usage");
    if (raw) {
      usage.value = parseClaudeUsage(raw);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    console.error("[usage] get_claude_usage failed:", error.value);
  } finally {
    loading.value = false;
  }
}

export function useClaudeUsage() {
  return { usage, loading, error, fetchUsage };
}

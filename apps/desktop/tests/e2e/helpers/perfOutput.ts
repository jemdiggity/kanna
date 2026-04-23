import { appendFile } from "node:fs/promises";

export interface DiffPerfSummary {
  fileCount: number;
  linesPerFile: number;
  totalChangedLines: number;
  thresholdMs: number;
  firstContentMs: number;
  renderedContainerCount: number;
  fileWrapperCount: number;
}

export function getE2ePerfOutputPath(): string | null {
  const configuredPath = process.env.KANNA_E2E_PERF_OUTPUT_PATH?.trim();
  return configuredPath ? configuredPath : null;
}

export function formatDiffPerfSummary(summary: DiffPerfSummary): string {
  return [
    "[e2e][diff-perf]",
    `firstContentMs=${summary.firstContentMs.toFixed(1)}ms`,
    `thresholdMs=${summary.thresholdMs}ms`,
    `rendered=${summary.renderedContainerCount}/${summary.fileWrapperCount}`,
    `totalChangedLines=${summary.totalChangedLines}`,
    `files=${summary.fileCount}`,
    `linesPerFile=${summary.linesPerFile}`,
  ].join(" ");
}

export async function appendE2ePerfSummaryLine(line: string): Promise<void> {
  const outputPath = getE2ePerfOutputPath();
  if (!outputPath) return;
  await appendFile(outputPath, `${line}\n`, "utf8");
}

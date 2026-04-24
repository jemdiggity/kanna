import { afterEach, describe, expect, it } from "vitest";
import {
  formatDiffPerfSummary,
  getE2ePerfOutputPath,
} from "./perfOutput";

describe("perfOutput", () => {
  afterEach(() => {
    delete process.env.KANNA_E2E_PERF_OUTPUT_PATH;
  });

  it("returns null when no perf output path is configured", () => {
    expect(getE2ePerfOutputPath()).toBeNull();
  });

  it("returns the configured perf output path", () => {
    process.env.KANNA_E2E_PERF_OUTPUT_PATH = "/tmp/kanna-perf.ndjson";

    expect(getE2ePerfOutputPath()).toBe("/tmp/kanna-perf.ndjson");
  });

  it("formats a stable diff perf summary line", () => {
    expect(formatDiffPerfSummary({
      fileCount: 20,
      linesPerFile: 1500,
      totalChangedLines: 30020,
      thresholdMs: 300,
      firstContentMs: 184.6,
      renderedContainerCount: 3,
      fileWrapperCount: 20,
    })).toBe(
      "[e2e][diff-perf] firstContentMs=184.6ms thresholdMs=300ms rendered=3/20 totalChangedLines=30020 files=20 linesPerFile=1500",
    );
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  beginTaskSwitch,
  clearTaskSwitchPerfRecords,
  getLatestTaskSwitchPerfRecord,
  getTaskSwitchPerfRecords,
  markTaskSwitchFirstOutput,
  markTaskSwitchMounted,
  markTaskSwitchReady,
} from "./taskSwitchPerf";

describe("taskSwitchPerf", () => {
  beforeEach(() => {
    clearTaskSwitchPerfRecords();
    performance.clearMarks();
    performance.clearMeasures();
  });

  it("records start, mounted, ready, and first-output once for a PTY task switch", () => {
    beginTaskSwitch("task-1");
    markTaskSwitchMounted("task-1");
    markTaskSwitchReady("task-1", "warm");
    markTaskSwitchFirstOutput("task-1");

    const record = getLatestTaskSwitchPerfRecord();

    expect(record?.taskId).toBe("task-1");
    expect(record?.terminalKind).toBe("pty");
    expect(record?.path).toBe("warm");
    expect(record?.completed).toBe(true);
    expect(record?.marks.start).toBeTypeOf("number");
    expect(record?.marks["terminal-mounted"]).toBeTypeOf("number");
    expect(record?.marks["terminal-ready"]).toBeTypeOf("number");
    expect(record?.marks["first-output"]).toBeTypeOf("number");
    expect(record?.measures.total).toBeTypeOf("number");
    expect(record?.measures.mount).toBeTypeOf("number");
    expect(record?.measures.ready).toBeTypeOf("number");
    expect(record?.measures["first-output"]).toBeTypeOf("number");
  });

  it("ignores duplicate mounted, ready, and first-output calls", () => {
    beginTaskSwitch("task-1");
    markTaskSwitchMounted("task-1");
    markTaskSwitchMounted("task-1");
    markTaskSwitchReady("task-1", "cold");
    markTaskSwitchReady("task-1", "warm");
    markTaskSwitchFirstOutput("task-1");
    markTaskSwitchFirstOutput("task-1");

    const record = getLatestTaskSwitchPerfRecord();

    expect(record?.path).toBe("cold");
    expect(Object.keys(record?.marks ?? {})).toEqual([
      "start",
      "terminal-mounted",
      "terminal-ready",
      "first-output",
    ]);
  });

  it("keeps only the most recent bounded history", () => {
    for (let index = 0; index < 15; index += 1) {
      beginTaskSwitch(`task-${index}`);
      markTaskSwitchMounted(`task-${index}`);
      markTaskSwitchReady(`task-${index}`, "unknown");
    }

    const records = getTaskSwitchPerfRecords();

    expect(records.length).toBeLessThanOrEqual(10);
    expect(records.at(-1)?.taskId).toBe("task-14");
  });

  it("ignores mounted and output phases for tasks that are no longer active", () => {
    beginTaskSwitch("task-1");
    beginTaskSwitch("task-2");

    markTaskSwitchMounted("task-1");
    markTaskSwitchFirstOutput("task-1");
    markTaskSwitchMounted("task-2");
    markTaskSwitchReady("task-2", "cold");

    const records = getTaskSwitchPerfRecords();
    const stale = records.find((record) => record.taskId === "task-1");
    const active = records.find((record) => record.taskId === "task-2");

    expect(stale?.marks).toEqual(expect.objectContaining({ start: expect.any(Number) }));
    expect(stale?.marks["terminal-mounted"]).toBeUndefined();
    expect(stale?.marks["first-output"]).toBeUndefined();
    expect(active?.marks["terminal-mounted"]).toBeTypeOf("number");
    expect(active?.marks["terminal-ready"]).toBeTypeOf("number");
  });
});

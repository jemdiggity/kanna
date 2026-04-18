import { describe, expect, it } from "vitest";
import { planTerminalMutation } from "./terminalMutation";

describe("planTerminalMutation", () => {
  it("replaces the terminal contents when the first output arrives", () => {
    expect(
      planTerminalMutation({
        previousOutput: "",
        previousStatus: "connecting",
        nextOutput: "Claude Code is starting\n",
        nextStatus: "live"
      })
    ).toEqual({
      kind: "replace",
      output: "Claude Code is starting\n",
      status: "live"
    });
  });

  it("appends only the new chunk when output grows", () => {
    expect(
      planTerminalMutation({
        previousOutput: "First line\n",
        previousStatus: "live",
        nextOutput: "First line\nSecond line\n",
        nextStatus: "live"
      })
    ).toEqual({
      kind: "append",
      chunk: "Second line\n"
    });
  });

  it("replaces the terminal when the visible buffer no longer extends the previous output", () => {
    expect(
      planTerminalMutation({
        previousOutput: "First line\nSecond line\n",
        previousStatus: "live",
        nextOutput: "Second line\nThird line\n",
        nextStatus: "live"
      })
    ).toEqual({
      kind: "replace",
      output: "Second line\nThird line\n",
      status: "live"
    });
  });

  it("replaces status copy when there is no terminal output", () => {
    expect(
      planTerminalMutation({
        previousOutput: "",
        previousStatus: "connecting",
        nextOutput: "",
        nextStatus: "idle"
      })
    ).toEqual({
      kind: "replace",
      output: "",
      status: "idle"
    });
  });

  it("does nothing when neither the output nor the visible empty-state changes", () => {
    expect(
      planTerminalMutation({
        previousOutput: "First line\n",
        previousStatus: "live",
        nextOutput: "First line\n",
        nextStatus: "closed"
      })
    ).toEqual({ kind: "none" });
  });
});

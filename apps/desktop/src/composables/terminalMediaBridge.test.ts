import { describe, expect, it } from "vitest"
import {
  buildKittyClipboardResponse,
  collectKittyClipboardRequests,
  encodeTerminalPasteBytes,
  formatDroppedPathsForPaste,
  updateBracketedPasteMode,
} from "./terminalMediaBridge"

describe("terminalMediaBridge", () => {
  it("shell-escapes dropped file paths", () => {
    expect(formatDroppedPathsForPaste([
      "/tmp/with spaces.png",
      "/tmp/quote's.png",
    ])).toBe("'/tmp/with spaces.png' '/tmp/quote'\"'\"'s.png'")
  })

  it("wraps pasted text in bracketed paste markers when enabled", () => {
    const bytes = encodeTerminalPasteBytes("hello world", true)
    expect(new TextDecoder().decode(bytes)).toBe("\u001b[200~hello world\u001b[201~")
  })

  it("updates bracketed paste mode from terminal output", () => {
    expect(updateBracketedPasteMode(false, "\u001b[?2004h")).toBe(true)
    expect(updateBracketedPasteMode(true, "\u001b[?2004l")).toBe(false)
  })

  it("parses kitty clipboard image read requests and leaves partial remainder", () => {
    const parseResult = collectKittyClipboardRequests(
      "\u001b]5522;type=read;aW1hZ2UvcG5nIHRleHQvcGxhaW4=\u0007\u001b]5522;type=read;aW1h",
    )

    expect(parseResult.requests).toEqual([
      { mimeTypes: ["image/png", "text/plain"] },
    ])
    expect(parseResult.remainder).toBe("\u001b]5522;type=read;aW1h")
  })

  it("builds a kitty clipboard image response", () => {
    const response = buildKittyClipboardResponse({
      mimeType: "image/png",
      pngBase64: "aGVsbG8=",
      width: 1,
      height: 1,
    })

    expect(response).toContain("5522;type=read:status=OK")
    expect(response).toContain("5522;type=read:status=DATA:mime=aW1hZ2UvcG5n;aGVsbG8=")
    expect(response).toContain("5522;type=read:status=DONE")
  })
})

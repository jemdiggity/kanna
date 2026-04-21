# Terminal Scroll QA

Date: 2026-04-20

## Scope

This QA checklist covers the desktop PTY terminal scroll fix that removes Kanna's custom per-chunk viewport restore in `apps/desktop/src/composables/useTerminal.ts`.

The bug being fixed:

- In live PTY sessions, especially Copilot and Codex, scrolling upward with the trackpad while the agent was still writing could yank the viewport back toward the live line.

The intended behavior after the fix:

- Manual scrollback remains under xterm.js control.
- Live PTY output continues to render without Kanna forcing `scrollToLine(...)` after every output chunk.
- Reconnect and recovery behavior still works.

## Data Path Sanity Check

The PTY-to-xterm path is sane as a layered design:

1. PTY child process writes bytes to the daemon-managed PTY.
2. `crates/daemon` reads PTY output, mirrors it into the daemon-side `TerminalSidecar`, and broadcasts output events.
3. `apps/desktop/src-tauri/src/lib.rs` subscribes to daemon events and emits `terminal_output` into the frontend.
4. `apps/desktop/src/composables/useTerminal.ts` receives those events and writes the bytes into xterm.js.

This is a reasonable boundary. The scroll bug was not caused by the PTY transport or the daemon layers. It was caused by frontend viewport ownership logic in `useTerminal.ts`, which was restoring `viewportY` after every chunk. Removing that custom scroll forcing is the correct architectural direction and matches how VS Code behaves more closely.

## Automated Verification Already Added

- `pnpm --dir apps/desktop test -- src/composables/useTerminal.test.ts`
- `pnpm --dir apps/desktop exec vue-tsc --noEmit`

The targeted regression test now verifies:

- manual scrollback during live output does not trigger `scrollToLine(...)`

## Known Test Gap

This behavior should ideally have E2E coverage because it crosses component and system boundaries:

- xterm.js viewport behavior
- frontend event handling
- live terminal output wiring

That E2E is not practical in the current mock browser harness because browser mode uses `mockListen`, and `mockListen` is a no-op. The E2E harness therefore cannot inject realistic `terminal_output` events into a mounted terminal today.

What would be needed for true E2E coverage:

- test-only event emission support in the browser mock `listen()` path, or
- a dedicated terminal test harness route that can inject output into a mounted `TerminalView`

The narrower coverage added in the meantime is the focused `useTerminal` regression test.

## Manual Test Matrix Before Shipping

Run the following on a worktree dev build, not on production data.

### Core Scroll Behavior

1. Create a Copilot PTY task that produces continuous output for at least 10-20 seconds.
Expected: while output is streaming, use a trackpad to scroll upward and remain scrolled up without being yanked back down.

2. Repeat with a Codex PTY task.
Expected: same result; no forced snap back during streaming output.

3. Repeat with a Claude PTY task.
Expected: scrolling up while Claude is rendering should also stay stable.

4. Scroll upward, stop touching the terminal, and let the agent continue writing.
Expected: viewport stays where the operator left it.

5. After scrolling upward, manually scroll back to the bottom.
Expected: the terminal naturally returns to following the latest output because the viewport is at the live bottom again.

6. Repeat the same checks using a mouse wheel instead of a trackpad.
Expected: no difference in behavior.

### Session Lifecycle / Recovery

7. Start a PTY task, let it produce visible output, then reload or restart the app instance without killing the live daemon session.
Expected: terminal reattaches correctly; no scroll regression appears after reconnect.

8. Start a PTY task, let it produce visible output, then trigger daemon turnover or reconnect behavior.
Expected: terminal reconnects, redraws, and still allows manual scrollback during subsequent live output.

9. Open a task with existing scrollback restored from snapshot or handoff state.
Expected: restored content remains visible and live output continues to append without frontend forced-scroll behavior.

### Provider Coverage

10. Verify Copilot in its busy state with the footer visible.
Expected: runtime status detection still works and terminal output still renders correctly.

11. Verify Codex while actively streaming output.
Expected: no viewport yank; input and output remain normal.

12. Verify Claude while actively streaming output.
Expected: no viewport yank; resize/redraw behavior still works.

### Input / Interaction Safety

13. While scrolled up, type into the terminal and continue interacting with the agent.
Expected: input is still delivered correctly; no broken PTY interaction.

14. While scrolled up, Cmd+click a file link in terminal output.
Expected: file preview still opens normally; no terminal breakage.

15. While scrolled up, paste text or perform the existing clipboard interactions used by agent terminals.
Expected: paste still works; no regression in terminal input path.

### Resize / Layout

16. While an agent is writing, resize the app window larger and smaller.
Expected: terminal redraw remains stable; no viewport oscillation or forced jump to an unrelated location.

17. While scrolled up, resize the window.
Expected: terminal may reflow, but should not exhibit the old repeated yank-down behavior on every output chunk.

18. Switch between tasks or tabs and come back to the active PTY task.
Expected: terminal remains usable and scroll behavior remains stable.

## Sign-off Guidance

Do not ship this change until at least:

- Copilot manual streaming test passes
- Codex manual streaming test passes
- one reconnect or daemon turnover scenario passes
- one resize-while-streaming scenario passes

If any provider still snaps back during live output, the next debugging target should be xterm viewport behavior under that provider's exact output pattern, not the PTY transport path.

# kanna-daemon Benchmarks

## Purpose

These benchmarks measure the daemon-side cost of replaying chatty agent terminal
updates and extracting agent status from the rendered terminal state.

They are intended for local comparison on the same machine. They are not a
portable CPU budget and they do not represent end-to-end app cost.

## Workloads

The benchmark suite uses deterministic synthetic transcripts defined in
[`src/bench/transcript.rs`](./src/bench/transcript.rs).

Each transcript models frequent small terminal updates rather than large chunks
of semantic output:

- `Codex`: thinking text shimmer plus prompt transitions
- `Claude`: spinner frames plus prompt transitions
- `Copilot`: thinking or cancel footer churn plus prompt transitions

Each provider has two modes:

- `steady`: realistic ongoing churn
- `worst_case`: more aggressive status-region churn

Transcript timestamps are logical replay timestamps. The benches do not sleep in
real time. The timestamps only control when status detection is allowed to run.

## Benchmarks

### `sidecar_status`

Command:

```bash
cd crates/daemon
cargo bench --bench sidecar_status
```

Cases:

- `write_only`: replay the full transcript through `TerminalSidecar::write()`
- `write_plus_status`: replay the same transcript and call `visible_status()`
  on the daemon throttle schedule, currently once every `500ms`

This isolates terminal emulation cost versus status-detection cost.

### `session_manager`

Command:

```bash
cd crates/daemon
cargo bench --bench session_manager
```

Cases:

- providers: `Codex`, `Claude`, `Copilot`
- modes: `steady`, `worst_case`
- session counts: `1`, `10`

This replays the same transcripts through the session-layer benchmark helper to
show scaling across multiple in-memory sessions.

## Current Baseline

Representative numbers from the current branch on this machine, after the
low-allocation footer-scan refactor in `visible_status()`.

### Sidecar

| Case | Time |
|------|------|
| `Codex_Steady/write_only` | `16.5 µs` |
| `Codex_Steady/write_plus_status` | `109.4 µs` |
| `Codex_WorstCase/write_only` | `21.7 µs` |
| `Codex_WorstCase/write_plus_status` | `156.0 µs` |
| `Claude_Steady/write_only` | `15.3 µs` |
| `Claude_Steady/write_plus_status` | `107.9 µs` |
| `Copilot_Steady/write_only` | `15.2 µs` |
| `Copilot_Steady/write_plus_status` | `106.9 µs` |
| `Copilot_WorstCase/write_plus_status` | `109.5 µs` |

Interpretation:

- raw sidecar replay is cheap
- status detection is the dominant additional cost in this layer

### Session Layer

| Case | Time |
|------|------|
| `Codex_Steady_1sessions` | `111.2 µs` |
| `Codex_Steady_10sessions` | `1.08 ms` |
| `Codex_WorstCase_1sessions` | `162.2 µs` |
| `Codex_WorstCase_10sessions` | `1.59 ms` |
| `Claude_Steady_1sessions` | `112.0 µs` |
| `Claude_Steady_10sessions` | `1.05 ms` |
| `Claude_WorstCase_10sessions` | `1.09 ms` |
| `Copilot_Steady_1sessions` | `105.9 µs` |
| `Copilot_Steady_10sessions` | `1.05 ms` |
| `Copilot_WorstCase_1sessions` | `108.2 µs` |
| `Copilot_WorstCase_10sessions` | `1.05 ms` |

Interpretation:

- the benchmarked session path scales into low milliseconds for 10 concurrent
  synthetic sessions
- these numbers are still only the daemon-side replay and status path, not the
  whole desktop app

## Important Caveats

- Criterion "regressed" or "improved" messages compare against previous local
  benchmark artifacts in `.build/criterion`. They are not automatically a
  branch-versus-main comparison.
- These benches do not include:
  - PTY read overhead
  - Unix socket transport
  - frontend or Tauri event delivery
  - xterm.js rendering
  - terminal recovery mirroring
- Because the workloads are synthetic, they should be treated as controlled
  probes for relative cost, not as perfect models of every real provider TUI.

## Reading The Numbers

The most useful comparisons are:

- `write_only` vs `write_plus_status`
  - tells you how much status detection adds beyond plain terminal replay
- `steady` vs `worst_case`
  - shows sensitivity to more aggressive status-region churn
- `1sessions` vs `10sessions`
  - shows how the session-layer replay cost scales with concurrent active
    sessions

If you want to compare a new optimization against this baseline, run the same
bench target on the same machine and compare the matching case names.

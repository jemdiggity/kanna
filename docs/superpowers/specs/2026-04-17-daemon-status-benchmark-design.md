# Daemon Status Benchmark Design

## Goal

Add local-only benchmarks that measure the real CPU-sensitive path behind chatty agent terminals:

- terminal emulation and render-state updates in the daemon sidecar
- status detection on top of that rendered terminal state
- scaling behavior from one active session to many active sessions

The benchmark suite must model the kinds of high-frequency UI churn real agent CLIs produce even when semantic output is minimal:

- Codex shimmer/thinking text updates
- Claude spinner updates
- Copilot blinking or thinking footer updates

The result should let developers compare changes to the daemon’s terminal-status path using deterministic workloads instead of guessing from Activity Monitor.

## Non-Goals

- No CI performance gate in this iteration
- No desktop-app or xterm.js benchmark
- No attempt to derive universal CPU numbers across machines
- No production feature changes to daemon behavior beyond benchmark hooks or testability refactors required to support the benchmark suite

## User Requirements

- Provide a standard for chatty-agent emulation
- Benchmark one session
- Benchmark ten sessions
- Support both realistic steady-state churn and worst-case churn
- Make workload mode selectable
- Emphasize the “silly little frequent updates” from each agent provider rather than bulk output
- Keep execution local/manual only

## Proposed Approach

Implement a layered local benchmark suite using one shared transcript standard:

1. A shared deterministic transcript generator models provider-specific terminal churn.
2. A sidecar microbenchmark measures terminal writes plus visible-status extraction directly.
3. A session-manager benchmark measures one-session and ten-session replay using the same transcript workload.

This gives two useful views of performance:

- an inner-loop measurement for libghostty plus footer/status extraction
- a daemon-layer measurement that includes session-manager bookkeeping and multi-session scaling

## Benchmark Workload Standard

### Workload Shape

The shared benchmark workload is a deterministic sequence of timestamped VT chunks. Each chunk represents a small terminal update rather than a large semantic message. This mirrors the real hot path, where many tiny writes repeatedly update visible footer or status content.

Each transcript is defined by:

- `provider`: `codex | claude | copilot`
- `mode`: `steady | worst_case`
- terminal geometry: default `cols=120`, `rows=40`
- ordered `chunks`: each chunk has a relative timestamp and byte payload
- expected phase transitions: startup, active/busy, optional waiting prompt, resumed work, idle prompt

### Provider Behavior

The generator must model provider-specific frequent-update behavior:

- `codex`: shimmer/thinking text churn in the status region plus idle prompt transitions
- `claude`: spinner-frame churn plus interrupt marker and idle prompt transitions
- `copilot`: blinking or “thinking” footer churn plus prompt transitions

The transcript does not need to perfectly copy any provider’s raw terminal output byte-for-byte. It does need to preserve the user-visible update pattern that drives status detection and rendering cost.

### Modes

- `steady`: realistic ongoing activity with moderate but frequent status-region updates
- `worst_case`: intentionally aggressive churn with more frequent and more visibly changing updates in the status/footer area

Both modes are selectable in every benchmark case.

### Determinism Rules

To keep runs comparable:

- all transcript bytes are generated deterministically
- no randomness is allowed unless seeded and fixed in code
- the same provider/mode pair always yields the same timestamped chunk sequence
- benchmark cases must replay the full transcript from a clean terminal state

## Benchmarks

### 1. Sidecar Status Benchmark

Location:

- `crates/daemon/benches/sidecar_status.rs`

Purpose:

- measure the cost of replaying provider-specific chatty updates into `TerminalSidecar`
- measure the incremental cost of extracting visible status from the rendered terminal state

Cases:

- each provider: `codex`, `claude`, `copilot`
- each mode: `steady`, `worst_case`
- `write_only`: replay all chunks with `sidecar.write()`
- `write_plus_status`: replay all chunks and call `visible_status()` only when the benchmark clock reaches the next status-check deadline

The status-check schedule must match daemon expectations: at most once every `500ms`.

### 2. Session Manager Benchmark

Location:

- `crates/daemon/benches/session_manager.rs`

Purpose:

- measure the cost of daemon-level replay using `SessionManager::mirror_output` and quiet refresh behavior
- compare one active session against many concurrently active sessions under the same workload standard

Cases:

- providers: at minimum `codex`, with `claude` and `copilot` included if generator coverage exists in the same change
- modes: `steady`, `worst_case`
- session counts: `1` and `10`

Workload execution:

- instantiate one session record per simulated session
- interleave timestamped chunks by replay time, not by “finish one session then start the next”
- use per-session logical clocks so each session respects the `500ms` status-detection throttle
- include quiet-refresh steps only when the transcript timeline passes refresh thresholds relevant to the benchmarked path

The ten-session case should emulate many active agents with low semantic output but constant visible-status churn.

## Shared Benchmark Module

Add a reusable benchmark module under daemon source, for example:

- `crates/daemon/src/bench/transcript.rs`

Responsibilities:

- define provider and mode enums
- generate timestamped VT chunks
- provide helpers to replay transcripts into the sidecar or session manager
- centralize transcript definitions so tests and future benchmarks can reuse the same workload standard

This module is benchmark support code, not production daemon behavior.

## Metrics

Each benchmark case should report practical local-comparison metrics through the benchmark harness:

- total replay time per transcript
- average time per chunk
- effective chunks per second

Derived comparison axes:

- provider vs provider
- `steady` vs `worst_case`
- `write_only` vs `write_plus_status`
- `1` session vs `10` sessions

The purpose is comparative regression detection, not absolute CPU budgeting across hardware.

## Tooling Choice

Use checked-in Rust benchmarks runnable locally from `crates/daemon` via `cargo bench`.

Initial command surface:

```bash
cd crates/daemon
cargo bench --bench sidecar_status
cargo bench --bench session_manager
```

Criterion is the preferred initial harness because it provides stable local benchmark output with minimal custom reporting code. A custom benchmark binary is out of scope unless Criterion proves insufficient.

## Validation Strategy

Validation for the benchmark implementation must ensure:

- transcript generator is deterministic
- provider-specific transcript fixtures contain the expected status markers and churn patterns
- single-session and ten-session benches run successfully from `cargo bench`
- benchmark cases actually exercise the intended path rather than accidentally benchmarking empty or no-op work

Supporting tests should verify:

- repeated transcript generation produces byte-identical output
- provider modes differ in frequency and/or transcript size as designed
- status-check cadence in benchmark replay aligns with the daemon throttle interval

## Risks and Mitigations

### Risk: benchmark becomes unrealistic

If transcripts are too synthetic, results may not match real-world load.

Mitigation:

- anchor transcript patterns to current observed provider UI behaviors
- model frequent footer/status churn rather than arbitrary random bytes
- keep the workload generator explicit and reviewable in code

### Risk: benchmark noise hides regressions

Local machines vary, and full daemon-style benchmarks can be noisy.

Mitigation:

- keep a sidecar microbenchmark as the low-noise signal
- use deterministic workloads
- treat results as comparative within a machine, not portable between machines

### Risk: benchmark code leaks into production behavior

Mitigation:

- isolate benchmark support in dedicated modules
- avoid changing daemon behavior except where small seams improve testability or replay control

## Implementation Scope

This design covers:

- benchmark workload standard
- local benchmark harnesses
- deterministic provider-specific transcript generation

This design does not cover:

- CI regression gates
- app-level profiling automation
- release performance dashboards

## Open Decisions Resolved

- Provider priority: start with Codex, but include Claude and Copilot patterns in the workload standard
- Modes: support both `steady` and `worst_case`
- Execution: local/manual only
- Benchmark layering: both sidecar microbench and multi-session daemon-level benchmark

## Recommended Implementation Order

1. Add deterministic transcript generator and unit tests.
2. Add sidecar benchmark using provider/mode cases.
3. Add session-manager benchmark with one-session and ten-session cases.
4. Run local benchmark baselines and document how to execute them.

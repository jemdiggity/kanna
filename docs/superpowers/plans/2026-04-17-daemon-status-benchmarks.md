# Daemon Status Benchmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local `cargo bench` benchmarks for chatty agent status detection using deterministic Codex/Claude/Copilot terminal transcripts, covering sidecar replay and one-session/ten-session daemon scaling.

**Architecture:** Add a shared benchmark support module inside the daemon crate that generates deterministic, provider-specific terminal churn transcripts and exposes replay helpers. Use that module from Criterion benches for the sidecar and the session manager, and add unit tests that prove transcript determinism and cadence behavior before writing any benchmark code.

**Tech Stack:** Rust, Criterion, libghostty-vt, kanna-daemon `TerminalSidecar`, `SessionManager`

---

## File Structure

- Modify: `crates/daemon/Cargo.toml`
  - Add benchmark dependencies and bench targets.
- Modify: `crates/daemon/src/lib.rs`
  - Export benchmark support and `session` module pieces needed by benches.
- Modify: `crates/daemon/src/session.rs`
  - Add minimal benchmark-only/testable seams if benches need replay helpers without real PTYs.
- Create: `crates/daemon/src/bench/mod.rs`
  - Benchmark support module boundary.
- Create: `crates/daemon/src/bench/transcript.rs`
  - Deterministic provider/mode transcript generator plus replay helpers and unit tests.
- Create: `crates/daemon/benches/sidecar_status.rs`
  - Criterion bench for `TerminalSidecar` write-only vs write-plus-status cases.
- Create: `crates/daemon/benches/session_manager.rs`
  - Criterion bench for one-session and ten-session replay using the shared transcript workload.

### Task 1: Add Transcript Generator Skeleton

**Files:**
- Modify: `crates/daemon/src/lib.rs`
- Create: `crates/daemon/src/bench/mod.rs`
- Create: `crates/daemon/src/bench/transcript.rs`
- Test: `crates/daemon/src/bench/transcript.rs`

- [ ] **Step 1: Write the failing transcript determinism tests**

```rust
#[cfg(test)]
mod tests {
    use super::{BenchmarkMode, BenchmarkProvider, TranscriptSpec};

    #[test]
    fn codex_steady_transcript_is_deterministic() {
        let first = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::Steady)
            .build();
        let second = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::Steady)
            .build();

        assert_eq!(first, second);
        assert!(!first.chunks.is_empty());
    }

    #[test]
    fn worst_case_emits_more_or_equal_chunks_than_steady() {
        let steady = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::Steady)
            .build();
        let worst = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::WorstCase)
            .build();

        assert!(worst.chunks.len() >= steady.chunks.len());
        assert!(
            worst.total_duration_ms >= steady.total_duration_ms,
            "worst-case transcript should be at least as chatty over time"
        );
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crates/daemon && cargo test codex_steady_transcript_is_deterministic -- --nocapture`
Expected: FAIL with unresolved import or missing `TranscriptSpec` / `BenchmarkProvider` / `BenchmarkMode`.

- [ ] **Step 3: Write the minimal benchmark support module**

```rust
// crates/daemon/src/lib.rs
pub mod bench;
pub mod protocol;
pub mod recovery;
pub mod sidecar;
pub mod session;
```

```rust
// crates/daemon/src/bench/mod.rs
pub mod transcript;
```

```rust
// crates/daemon/src/bench/transcript.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BenchmarkProvider {
    Codex,
    Claude,
    Copilot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BenchmarkMode {
    Steady,
    WorstCase,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimedChunk {
    pub at_ms: u64,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transcript {
    pub provider: BenchmarkProvider,
    pub mode: BenchmarkMode,
    pub total_duration_ms: u64,
    pub chunks: Vec<TimedChunk>,
}

#[derive(Debug, Clone, Copy)]
pub struct TranscriptSpec {
    provider: BenchmarkProvider,
    mode: BenchmarkMode,
}

impl TranscriptSpec {
    pub fn new(provider: BenchmarkProvider, mode: BenchmarkMode) -> Self {
        Self { provider, mode }
    }

    pub fn build(self) -> Transcript {
        Transcript {
            provider: self.provider,
            mode: self.mode,
            total_duration_ms: 0,
            chunks: Vec::new(),
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes far enough to expose missing behavior**

Run: `cd crates/daemon && cargo test worst_case_emits_more_or_equal_chunks_than_steady -- --nocapture`
Expected: FAIL because `chunks` is empty or worst-case does not differ from steady.

- [ ] **Step 5: Implement deterministic Codex transcript generation**

```rust
fn codex_chunks(mode: BenchmarkMode) -> Vec<TimedChunk> {
    let base = [
        (0_u64, "Booting\r\n"),
        (120, "Thinking.\r\n"),
        (240, "Thinking..\r\n"),
        (360, "Thinking...\r\n"),
        (520, "› review the diff\r\n"),
        (880, "\r\u{1b}[2KThinking..\r\n"),
        (1_200, "\r\u{1b}[2K›\r\n"),
    ];

    let extra = match mode {
        BenchmarkMode::Steady => vec![(1_600, "Thinking...\r\n"), (2_000, "›\r\n")],
        BenchmarkMode::WorstCase => vec![
            (480, "\r\u{1b}[2KThinking....\r\n"),
            (600, "\r\u{1b}[2KThinking.....\r\n"),
            (720, "\r\u{1b}[2KThinking......\r\n"),
            (1_600, "Thinking...\r\n"),
            (1_720, "Thinking..\r\n"),
            (1_840, "Thinking.\r\n"),
            (2_000, "›\r\n"),
        ],
    };

    base.into_iter()
        .chain(extra)
        .map(|(at_ms, text)| TimedChunk {
            at_ms,
            bytes: text.as_bytes().to_vec(),
        })
        .collect()
}
```

- [ ] **Step 6: Run transcript tests to verify they pass**

Run: `cd crates/daemon && cargo test transcript::tests -- --nocapture`
Expected: PASS for determinism and Codex steady/worst-case shape assertions.

- [ ] **Step 7: Commit**

```bash
git add crates/daemon/src/lib.rs crates/daemon/src/bench/mod.rs crates/daemon/src/bench/transcript.rs
git commit -m "Add daemon benchmark transcript support"
```

### Task 2: Expand Transcript Coverage For All Providers And Cadence Helpers

**Files:**
- Modify: `crates/daemon/src/bench/transcript.rs`
- Test: `crates/daemon/src/bench/transcript.rs`

- [ ] **Step 1: Write the failing provider coverage and cadence tests**

```rust
#[test]
fn all_provider_modes_emit_visible_status_markers() {
    for provider in [
        BenchmarkProvider::Codex,
        BenchmarkProvider::Claude,
        BenchmarkProvider::Copilot,
    ] {
        for mode in [BenchmarkMode::Steady, BenchmarkMode::WorstCase] {
            let transcript = TranscriptSpec::new(provider, mode).build();
            let joined = transcript
                .chunks
                .iter()
                .flat_map(|chunk| chunk.bytes.iter().copied())
                .collect::<Vec<u8>>();
            let text = String::from_utf8_lossy(&joined).to_lowercase();

            assert!(
                text.contains("thinking")
                    || text.contains("esc to interrupt")
                    || text.contains("esc to cancel")
                    || text.contains("›")
                    || text.contains("❯"),
                "provider transcript should include recognizable status UI"
            );
        }
    }
}

#[test]
fn status_check_schedule_respects_five_hundred_ms_throttle() {
    let transcript = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::WorstCase)
        .build();
    let ticks = transcript.status_check_points_ms(500);

    assert!(!ticks.is_empty());
    assert!(ticks.windows(2).all(|pair| pair[1] - pair[0] >= 500));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crates/daemon && cargo test all_provider_modes_emit_visible_status_markers -- --nocapture`
Expected: FAIL because Claude/Copilot transcripts or `status_check_points_ms` do not exist yet.

- [ ] **Step 3: Implement provider transcripts and cadence helper**

```rust
impl Transcript {
    pub fn status_check_points_ms(&self, throttle_ms: u64) -> Vec<u64> {
        let mut next_check_at = 0;
        let mut checks = Vec::new();

        for chunk in &self.chunks {
            if chunk.at_ms >= next_check_at {
                checks.push(chunk.at_ms);
                next_check_at = chunk.at_ms + throttle_ms;
            }
        }

        checks
    }
}

fn claude_chunks(mode: BenchmarkMode) -> Vec<TimedChunk> {
    let frames = match mode {
        BenchmarkMode::Steady => ["✻", "✽", "✶", "❯"],
        BenchmarkMode::WorstCase => ["✻", "✽", "✶", "✳", "✢", "⏺", "❯"],
    };

    frames
        .into_iter()
        .enumerate()
        .map(|(index, frame)| TimedChunk {
            at_ms: (index as u64) * 160,
            bytes: format!("{}\r\nesc to interrupt\r\n", frame).into_bytes(),
        })
        .collect()
}

fn copilot_chunks(mode: BenchmarkMode) -> Vec<TimedChunk> {
    let footer = match mode {
        BenchmarkMode::Steady => vec!["thinking", "thinking.", "thinking..", "❯"],
        BenchmarkMode::WorstCase => vec![
            "thinking",
            "thinking.",
            "thinking..",
            "thinking...",
            "esc to cancel",
            "❯",
        ],
    };

    footer
        .into_iter()
        .enumerate()
        .map(|(index, line)| TimedChunk {
            at_ms: (index as u64) * 140,
            bytes: format!("{}\r\n", line).into_bytes(),
        })
        .collect()
}
```

- [ ] **Step 4: Hook `TranscriptSpec::build()` up to provider-specific generators**

```rust
pub fn build(self) -> Transcript {
    let chunks = match self.provider {
        BenchmarkProvider::Codex => codex_chunks(self.mode),
        BenchmarkProvider::Claude => claude_chunks(self.mode),
        BenchmarkProvider::Copilot => copilot_chunks(self.mode),
    };
    let total_duration_ms = chunks.last().map(|chunk| chunk.at_ms).unwrap_or(0);

    Transcript {
        provider: self.provider,
        mode: self.mode,
        total_duration_ms,
        chunks,
    }
}
```

- [ ] **Step 5: Run transcript tests to verify provider coverage and cadence**

Run: `cd crates/daemon && cargo test transcript::tests -- --nocapture`
Expected: PASS with provider coverage and 500ms cadence tests green.

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/src/bench/transcript.rs
git commit -m "Add provider chatty transcript fixtures"
```

### Task 3: Wire Criterion And Add Sidecar Bench

**Files:**
- Modify: `crates/daemon/Cargo.toml`
- Create: `crates/daemon/benches/sidecar_status.rs`
- Test: `crates/daemon/benches/sidecar_status.rs`

- [ ] **Step 1: Write the failing bench target setup**

```toml
[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }

[[bench]]
name = "sidecar_status"
harness = false
```

- [ ] **Step 2: Run bench command to verify the missing bench fails**

Run: `cd crates/daemon && cargo bench --bench sidecar_status --no-run`
Expected: FAIL because `crates/daemon/benches/sidecar_status.rs` does not exist yet.

- [ ] **Step 3: Add the minimal sidecar benchmark**

```rust
use criterion::{criterion_group, criterion_main, Criterion};
use kanna_daemon::bench::transcript::{BenchmarkMode, BenchmarkProvider, TranscriptSpec};
use kanna_daemon::sidecar::TerminalSidecar;
use kanna_daemon::protocol::AgentProvider;

fn provider_to_agent(provider: BenchmarkProvider) -> AgentProvider {
    match provider {
        BenchmarkProvider::Codex => AgentProvider::Codex,
        BenchmarkProvider::Claude => AgentProvider::Claude,
        BenchmarkProvider::Copilot => AgentProvider::Copilot,
    }
}

fn bench_sidecar_status(c: &mut Criterion) {
    let mut group = c.benchmark_group("sidecar_status");

    for provider in [
        BenchmarkProvider::Codex,
        BenchmarkProvider::Claude,
        BenchmarkProvider::Copilot,
    ] {
        for mode in [BenchmarkMode::Steady, BenchmarkMode::WorstCase] {
            let transcript = TranscriptSpec::new(provider, mode).build();
            let case_name = format!("{provider:?}_{mode:?}");

            group.bench_function(format!("{case_name}/write_only"), |b| {
                b.iter(|| {
                    let mut sidecar = TerminalSidecar::new(120, 40, 10_000).unwrap();
                    for chunk in &transcript.chunks {
                        sidecar.write(&chunk.bytes);
                    }
                });
            });

            group.bench_function(format!("{case_name}/write_plus_status"), |b| {
                b.iter(|| {
                    let mut sidecar = TerminalSidecar::new(120, 40, 10_000).unwrap();
                    let mut next_check_at = 0_u64;
                    for chunk in &transcript.chunks {
                        sidecar.write(&chunk.bytes);
                        if chunk.at_ms >= next_check_at {
                            let _ = sidecar.visible_status(Some(provider_to_agent(provider))).unwrap();
                            next_check_at = chunk.at_ms + 500;
                        }
                    }
                });
            });
        }
    }

    group.finish();
}

criterion_group!(benches, bench_sidecar_status);
criterion_main!(benches);
```

- [ ] **Step 4: Run bench target build to verify it passes**

Run: `cd crates/daemon && cargo bench --bench sidecar_status --no-run`
Expected: PASS and Criterion bench target compiles.

- [ ] **Step 5: Run the sidecar benchmark**

Run: `cd crates/daemon && cargo bench --bench sidecar_status`
Expected: PASS with Criterion output for all provider/mode and write-only/write-plus-status cases.

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/Cargo.toml crates/daemon/benches/sidecar_status.rs
git commit -m "Add sidecar status benchmarks"
```

### Task 4: Make Session Replay Benchmarkable Without Real PTYs

**Files:**
- Modify: `crates/daemon/src/session.rs`
- Test: `crates/daemon/src/session.rs`

- [ ] **Step 1: Write the failing replay helper test**

```rust
#[test]
fn benchmark_replay_updates_status_without_real_pty_io() {
    use crate::bench::transcript::{BenchmarkMode, BenchmarkProvider, TranscriptSpec};
    use crate::sidecar::initial_session_status;

    let transcript = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::Steady).build();
    let mut sidecar = TerminalSidecar::new(120, 40, 10_000).unwrap();
    let mut status = initial_session_status(Some(AgentProvider::Codex));
    let mut status_observed = false;
    let mut last_status_check_at = None;

    for chunk in &transcript.chunks {
        let changed = replay_sidecar_for_benchmark(
            &mut sidecar,
            Some(AgentProvider::Codex),
            &mut status,
            &mut status_observed,
            &mut last_status_check_at,
            chunk,
        )
        .unwrap();

        if let Some(next) = changed {
            status = next;
        }
    }

    assert!(matches!(status, SessionStatus::Busy | SessionStatus::Idle));
    assert!(status_observed);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crates/daemon && cargo test benchmark_replay_updates_status_without_real_pty_io -- --nocapture`
Expected: FAIL because `replay_sidecar_for_benchmark` does not exist.

- [ ] **Step 3: Extract a small benchmark replay helper from existing status logic**

```rust
use crate::bench::transcript::TimedChunk;

pub fn replay_sidecar_for_benchmark(
    sidecar: &mut TerminalSidecar,
    agent_provider: Option<AgentProvider>,
    status: &mut SessionStatus,
    status_observed: &mut bool,
    last_status_check_at: &mut Option<Instant>,
    chunk: &TimedChunk,
) -> Result<Option<SessionStatus>, Box<dyn std::error::Error + Send + Sync>> {
    sidecar.write(&chunk.bytes);

    let now = Instant::now()
        .checked_add(Duration::from_millis(chunk.at_ms))
        .unwrap_or_else(Instant::now);

    if last_status_check_at
        .is_some_and(|last| now.saturating_duration_since(last) < status_detection_throttle())
    {
        return Ok(None);
    }

    *last_status_check_at = Some(now);

    let visible_status = sidecar.visible_status(agent_provider)?;
    if let Some(next_status) = visible_status {
        *status_observed = true;
        return Ok(if *status != next_status {
            Some(next_status)
        } else {
            None
        });
    }

    Ok(None)
}
```

- [ ] **Step 4: Run targeted session tests to verify the helper and existing tests pass**

Run: `cd crates/daemon && cargo test session::tests -- --nocapture`
Expected: PASS with new helper test and existing status throttling tests green.

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/session.rs
git commit -m "Extract benchmark replay helper for session status"
```

### Task 5: Add One-Session And Ten-Session Session Manager Bench

**Files:**
- Modify: `crates/daemon/Cargo.toml`
- Create: `crates/daemon/benches/session_manager.rs`
- Test: `crates/daemon/benches/session_manager.rs`

- [ ] **Step 1: Write the failing second bench target setup**

```toml
[[bench]]
name = "session_manager"
harness = false
```

- [ ] **Step 2: Run bench command to verify the missing bench fails**

Run: `cd crates/daemon && cargo bench --bench session_manager --no-run`
Expected: FAIL because `crates/daemon/benches/session_manager.rs` does not exist yet.

- [ ] **Step 3: Add session replay benchmark**

```rust
use criterion::{criterion_group, criterion_main, Criterion};
use kanna_daemon::bench::transcript::{BenchmarkMode, BenchmarkProvider, TranscriptSpec};
use kanna_daemon::protocol::{AgentProvider, SessionStatus};
use kanna_daemon::session::replay_sidecar_for_benchmark;
use kanna_daemon::sidecar::{initial_session_status, TerminalSidecar};
use std::time::Instant;

fn agent_provider(provider: BenchmarkProvider) -> AgentProvider {
    match provider {
        BenchmarkProvider::Codex => AgentProvider::Codex,
        BenchmarkProvider::Claude => AgentProvider::Claude,
        BenchmarkProvider::Copilot => AgentProvider::Copilot,
    }
}

fn replay_case(provider: BenchmarkProvider, mode: BenchmarkMode, sessions: usize) {
    let transcript = TranscriptSpec::new(provider, mode).build();
    let provider = Some(agent_provider(provider));
    let mut sidecars = (0..sessions)
        .map(|_| TerminalSidecar::new(120, 40, 10_000).unwrap())
        .collect::<Vec<_>>();
    let mut statuses = vec![initial_session_status(provider); sessions];
    let mut observed = vec![false; sessions];
    let mut checks = vec![None::<Instant>; sessions];

    for chunk in &transcript.chunks {
        for index in 0..sessions {
            let changed = replay_sidecar_for_benchmark(
                &mut sidecars[index],
                provider,
                &mut statuses[index],
                &mut observed[index],
                &mut checks[index],
                chunk,
            )
            .unwrap();

            if let Some(next) = changed {
                statuses[index] = next;
            }
        }
    }

    assert!(observed.iter().all(|seen| *seen));
    assert!(statuses.iter().all(|status| matches!(status, SessionStatus::Busy | SessionStatus::Idle | SessionStatus::Waiting)));
}

fn bench_session_manager(c: &mut Criterion) {
    let mut group = c.benchmark_group("session_manager");

    for provider in [
        BenchmarkProvider::Codex,
        BenchmarkProvider::Claude,
        BenchmarkProvider::Copilot,
    ] {
        for mode in [BenchmarkMode::Steady, BenchmarkMode::WorstCase] {
            for session_count in [1_usize, 10_usize] {
                let case_name = format!("{provider:?}_{mode:?}_{session_count}sessions");
                group.bench_function(case_name, |b| {
                    b.iter(|| replay_case(provider, mode, session_count));
                });
            }
        }
    }

    group.finish();
}

criterion_group!(benches, bench_session_manager);
criterion_main!(benches);
```

- [ ] **Step 4: Run bench target build to verify it passes**

Run: `cd crates/daemon && cargo bench --bench session_manager --no-run`
Expected: PASS and Criterion compiles the multi-session bench target.

- [ ] **Step 5: Run the session-manager benchmark**

Run: `cd crates/daemon && cargo bench --bench session_manager`
Expected: PASS with Criterion output for one-session and ten-session cases across providers and modes.

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/Cargo.toml crates/daemon/benches/session_manager.rs
git commit -m "Add daemon multi-session status benchmarks"
```

### Task 6: Final Verification And Usage Notes

**Files:**
- Modify: `docs/superpowers/specs/2026-04-17-daemon-status-benchmark-design.md`
  - Only if implementation diverged and the spec needs alignment.

- [ ] **Step 1: Run formatting**

Run: `cd crates/daemon && cargo fmt --all`
Expected: PASS with no formatting errors.

- [ ] **Step 2: Run daemon test suite**

Run: `cd crates/daemon && cargo test -- --nocapture`
Expected: PASS with transcript tests, session tests, and integration tests all green.

- [ ] **Step 3: Run Clippy**

Run: `cd crates/daemon && cargo clippy --all-targets -- -D warnings`
Expected: PASS with no warnings.

- [ ] **Step 4: Run both benchmark targets once**

Run: `cd crates/daemon && cargo bench --bench sidecar_status && cargo bench --bench session_manager`
Expected: PASS with Criterion result output for all defined cases.

- [ ] **Step 5: Check for whitespace and unintended diffs**

Run: `git diff --check && git status --short`
Expected: PASS with no whitespace errors and only intended daemon benchmark files modified.

- [ ] **Step 6: Commit final cleanup**

```bash
git add crates/daemon/Cargo.toml crates/daemon/src/lib.rs crates/daemon/src/session.rs crates/daemon/src/bench/mod.rs crates/daemon/src/bench/transcript.rs crates/daemon/benches/sidecar_status.rs crates/daemon/benches/session_manager.rs
git commit -m "Add daemon status benchmark suite"
```

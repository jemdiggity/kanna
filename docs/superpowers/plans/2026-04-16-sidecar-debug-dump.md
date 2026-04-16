# Sidecar Debug Dump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daemon-side debug dump of the sidecar's last rendered lines so status detection can be debugged from logs without guessing at the visible footer.

**Architecture:** Extend `TerminalSidecar` with a small rendered-lines debug API, thread that through session status evaluation, and emit structured log lines from the daemon when a status is evaluated during PTY output mirroring or quiet refresh. Cover the new behavior with focused Rust unit tests rather than adding a new socket surface.

**Tech Stack:** Rust, tokio, flexi_logger, libghostty_vt, cargo test

---

### Task 1: Add a sidecar debug dump API

**Files:**
- Modify: `crates/daemon/src/sidecar.rs`
- Test: `crates/daemon/src/sidecar.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn debug_lines_returns_last_non_empty_rendered_rows() {
    let mut sidecar = TerminalSidecar::new(20, 6, 10_000).unwrap();
    sidecar.write(
        "Header\r\n\r\nThinking hard\r\n(Esc to cancel)\r\n".as_bytes(),
    );

    assert_eq!(
        sidecar.debug_lines(3).unwrap(),
        vec![
            "Header".to_string(),
            "Thinking hard".to_string(),
            "(Esc to cancel)".to_string(),
        ]
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p kanna-daemon debug_lines_returns_last_non_empty_rendered_rows -- --nocapture`
Expected: FAIL because `TerminalSidecar::debug_lines` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```rust
pub fn debug_lines(&mut self, rows: usize) -> SidecarResult<Vec<String>> {
    self.visible_footer_lines(rows)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p kanna-daemon debug_lines_returns_last_non_empty_rendered_rows -- --nocapture`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/sidecar.rs docs/superpowers/plans/2026-04-16-sidecar-debug-dump.md
git commit -m "feat: add sidecar debug line dump"
```

### Task 2: Emit structured daemon log lines for status evaluation

**Files:**
- Modify: `crates/daemon/src/session.rs`
- Test: `crates/daemon/src/session.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn mirror_output_exposes_debug_lines_alongside_detected_status() {
    let mut manager = SessionManager::new();
    let mut record = spawn_test_record(AgentProvider::Copilot, SessionStatus::Idle).unwrap();
    record.sidecar.write("Header\r\n(Esc to cancel)".as_bytes());
    manager.insert("copilot".to_string(), record);

    let observation = manager
        .debug_status_observation("copilot")
        .unwrap()
        .unwrap();

    assert_eq!(observation.detected_status, Some(SessionStatus::Busy));
    assert!(observation.lines.iter().any(|line| line.contains("Esc to cancel")));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p kanna-daemon mirror_output_exposes_debug_lines_alongside_detected_status -- --nocapture`
Expected: FAIL because `debug_status_observation` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```rust
pub struct StatusObservation {
    pub detected_status: Option<SessionStatus>,
    pub lines: Vec<String>,
}

pub fn debug_status_observation(
    &mut self,
    session_id: &str,
) -> Result<Option<StatusObservation>, Box<dyn std::error::Error + Send + Sync>> {
    let Some(session) = self.sessions.get_mut(session_id) else {
        return Ok(None);
    };

    Ok(Some(StatusObservation {
        detected_status: session.sidecar.visible_status(session.agent_provider)?,
        lines: session.sidecar.debug_lines(8)?,
    }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p kanna-daemon mirror_output_exposes_debug_lines_alongside_detected_status -- --nocapture`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/session.rs
git commit -m "feat: expose sidecar status debug observations"
```

### Task 3: Log status observations from the daemon status path

**Files:**
- Modify: `crates/daemon/src/main.rs`
- Test: `crates/daemon/src/main.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn format_status_observation_log_includes_session_source_status_and_lines() {
    let lines = vec!["Header".to_string(), "(Esc to cancel)".to_string()];

    let log_line = format_status_observation_log(
        "dbaa5b9d",
        "mirror_output",
        Some(AgentProvider::Copilot),
        Some(SessionStatus::Busy),
        &lines,
    );

    assert!(log_line.contains("session=dbaa5b9d"));
    assert!(log_line.contains("source=mirror_output"));
    assert!(log_line.contains("detected=busy"));
    assert!(log_line.contains("Esc to cancel"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p kanna-daemon format_status_observation_log_includes_session_source_status_and_lines -- --nocapture`
Expected: FAIL because the formatter does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```rust
fn format_status_observation_log(
    session_id: &str,
    source: &str,
    provider: Option<AgentProvider>,
    detected_status: Option<SessionStatus>,
    lines: &[String],
) -> String {
    format!(
        "[sidecar-debug] session={} source={} provider={:?} detected={:?} lines={:?}",
        session_id, source, provider, detected_status, lines
    )
}
```

- [ ] **Step 4: Wire the logger into the PTY mirror and quiet refresh paths**

```rust
if let Ok(Some(observation)) = rt.block_on(async {
    let mut mgr = sessions.lock().await;
    mgr.debug_status_observation(&session_id)
}) {
    log::info!(
        "{}",
        format_status_observation_log(
            &session_id,
            "mirror_output",
            observation.provider,
            observation.detected_status,
            &observation.lines,
        )
    );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p kanna-daemon format_status_observation_log_includes_session_source_status_and_lines -- --nocapture`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/src/main.rs
git commit -m "feat: log sidecar status debug dumps"
```

### Task 4: Verify the daemon build and targeted tests

**Files:**
- Modify: `none`
- Test: `crates/daemon/src/sidecar.rs`, `crates/daemon/src/session.rs`, `crates/daemon/src/main.rs`

- [ ] **Step 1: Run the focused daemon tests**

Run: `cargo test -p kanna-daemon debug_lines_returns_last_non_empty_rendered_rows mirror_output_exposes_debug_lines_alongside_detected_status format_status_observation_log_includes_session_source_status_and_lines -- --nocapture`
Expected: PASS

- [ ] **Step 2: Run the full daemon test suite**

Run: `cargo test -p kanna-daemon -- --nocapture`
Expected: PASS

- [ ] **Step 3: Run clippy for the daemon crate**

Run: `cargo clippy -p kanna-daemon --tests -- -D warnings`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add Cargo.lock
git commit -m "test: verify sidecar debug dump logging"
```

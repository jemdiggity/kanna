use kanna_daemon::protocol::{AgentProvider, SessionStatus};
use kanna_daemon::status::{initial_session_status, StatusTracker};
use std::time::Duration;

#[test]
fn detects_codex_busy_and_idle_across_fragments() {
    let mut tracker = StatusTracker::new(Some(AgentProvider::Codex));

    assert!(tracker.ingest_output(b"esc to inter").is_empty());
    assert_eq!(tracker.ingest_output(b"rupt"), vec![SessionStatus::Busy]);
    assert_eq!(
        tracker.ingest_output("\u{203A}".as_bytes()),
        vec![SessionStatus::Idle]
    );
}

#[test]
fn detects_waiting_prompt_for_agent_sessions() {
    let mut tracker = StatusTracker::new(Some(AgentProvider::Claude));

    assert_eq!(
        tracker.ingest_output(b"Do you want to allow"),
        vec![SessionStatus::Waiting]
    );
}

#[test]
fn ignores_status_detection_for_non_agent_sessions() {
    let mut tracker = StatusTracker::new(None);

    assert!(tracker.ingest_output(b"esc to interrupt").is_empty());
    assert!(tracker.ingest_output(b"Do you want to allow").is_empty());
}

#[test]
fn copilot_returns_to_idle_after_quiet_period() {
    let mut tracker = StatusTracker::new(Some(AgentProvider::Copilot));

    assert_eq!(
        tracker.ingest_output(b"Esc to cancel"),
        vec![SessionStatus::Busy]
    );
    assert_eq!(
        tracker.flush_idle_if_quiet(Duration::ZERO),
        vec![SessionStatus::Idle]
    );
}

#[test]
fn agent_sessions_start_busy() {
    assert_eq!(
        initial_session_status(Some(AgentProvider::Claude)),
        SessionStatus::Busy
    );
    assert_eq!(
        initial_session_status(Some(AgentProvider::Copilot)),
        SessionStatus::Busy
    );
    assert_eq!(
        initial_session_status(Some(AgentProvider::Codex)),
        SessionStatus::Busy
    );
    assert_eq!(initial_session_status(None), SessionStatus::Idle);
}

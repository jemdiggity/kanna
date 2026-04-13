use crate::protocol::{AgentProvider, SessionStatus};
use std::time::{Duration, Instant};

const SCAN_BUFFER_CAP: usize = 4096;
const SCAN_MATCH_CARRY: usize = 32;

// Text shown in Claude's status bar ONLY while actively processing.
// After ANSI stripping, cursor-movement codes collapse the spaces.
const CLAUDE_WORKING_INDICATOR: &str = "esctointerrupt";
const CLAUDE_IDLE_PROMPT: char = '\u{276F}';
const CODEX_WORKING_INDICATOR: &str = "esc to interrupt";
const CODEX_IDLE_PROMPT: char = '\u{203A}';

pub struct StatusTracker {
    buffer: String,
    last_data_at: Instant,
    current: SessionStatus,
    provider: Option<AgentProvider>,
}

pub fn initial_session_status(provider: Option<AgentProvider>) -> SessionStatus {
    if provider.is_some() {
        SessionStatus::Busy
    } else {
        SessionStatus::Idle
    }
}

impl StatusTracker {
    pub fn new(provider: Option<AgentProvider>) -> Self {
        Self {
            buffer: String::new(),
            last_data_at: Instant::now(),
            current: SessionStatus::Idle,
            provider,
        }
    }

    pub fn current_status(&self) -> SessionStatus {
        self.current
    }

    pub fn ingest_output(&mut self, bytes: &[u8]) -> Vec<SessionStatus> {
        let Some(provider) = self.provider else {
            return Vec::new();
        };

        let text = strip_terminal_output(bytes);
        if text.is_empty() {
            return Vec::new();
        }

        let scan_text = self.recent_scan_text(&text);
        self.append(&text);
        let mut events = Vec::new();

        match provider {
            AgentProvider::Claude => {
                self.push_transition(
                    latest_transition(&scan_text, CLAUDE_WORKING_INDICATOR, CLAUDE_IDLE_PROMPT),
                    &mut events,
                );
                if text.contains("Do you want to allow") {
                    self.push_status(SessionStatus::Waiting, &mut events);
                }
            }
            AgentProvider::Codex => {
                self.push_transition(
                    latest_transition(&scan_text, CODEX_WORKING_INDICATOR, CODEX_IDLE_PROMPT),
                    &mut events,
                );
                if text.contains("Do you want to allow") {
                    self.push_status(SessionStatus::Waiting, &mut events);
                }
            }
            AgentProvider::Copilot => {
                if text.contains("Esc to cancel") {
                    self.push_status(SessionStatus::Busy, &mut events);
                }
                if text.contains("Operation cancelled") {
                    self.push_status(SessionStatus::Idle, &mut events);
                }
            }
        }

        if text.contains("Interrupted") {
            self.push_status(SessionStatus::Idle, &mut events);
        }

        events
    }

    pub fn flush_idle_if_quiet(&mut self, quiet_for: Duration) -> Vec<SessionStatus> {
        if self.last_data_at.elapsed() < quiet_for {
            return Vec::new();
        }

        self.buffer.clear();
        if self.provider == Some(AgentProvider::Copilot) && self.current == SessionStatus::Busy {
            self.current = SessionStatus::Idle;
            return vec![SessionStatus::Idle];
        }
        Vec::new()
    }

    pub fn last_data_at(&self) -> Instant {
        self.last_data_at
    }

    fn push_transition(&mut self, status: Option<SessionStatus>, events: &mut Vec<SessionStatus>) {
        if let Some(status) = status {
            self.push_status(status, events);
        }
    }

    fn push_status(&mut self, status: SessionStatus, events: &mut Vec<SessionStatus>) {
        if self.current != status {
            self.current = status;
            events.push(status);
        }
    }

    fn append(&mut self, text: &str) {
        self.buffer.push_str(text);
        self.last_data_at = Instant::now();
        if self.buffer.len() > SCAN_BUFFER_CAP {
            let mut drain_to = self.buffer.len() - SCAN_BUFFER_CAP;
            while drain_to < self.buffer.len() && !self.buffer.is_char_boundary(drain_to) {
                drain_to += 1;
            }
            self.buffer.drain(..drain_to);
        }
    }

    fn recent_scan_text(&self, text: &str) -> String {
        let carry_start = self
            .buffer
            .char_indices()
            .rev()
            .nth(SCAN_MATCH_CARRY.saturating_sub(1))
            .map(|(index, _)| index)
            .unwrap_or(0);
        let carry = &self.buffer[carry_start..];

        let mut scan_text = String::with_capacity(carry.len() + text.len());
        scan_text.push_str(carry);
        scan_text.push_str(text);
        scan_text
    }
}

fn latest_transition(
    scan_text: &str,
    working_indicator: &str,
    idle_prompt: char,
) -> Option<SessionStatus> {
    let last_working = scan_text.rfind(working_indicator);
    let last_idle = scan_text.rfind(idle_prompt);

    match (last_working, last_idle) {
        (Some(working), Some(idle)) if working > idle => Some(SessionStatus::Busy),
        (_, Some(_)) => Some(SessionStatus::Idle),
        (Some(_), None) => Some(SessionStatus::Busy),
        (None, None) => None,
    }
}

fn strip_terminal_output(bytes: &[u8]) -> String {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b {
            i += 1;
            if i < bytes.len() && bytes[i] == b'[' {
                i += 1;
                while i < bytes.len() && !(bytes[i] >= 0x40 && bytes[i] <= 0x7e) {
                    i += 1;
                }
                if i < bytes.len() {
                    i += 1;
                }
            } else if i < bytes.len() && bytes[i] == b']' {
                i += 1;
                while i < bytes.len() && bytes[i] != 0x07 && bytes[i] != 0x1b {
                    i += 1;
                }
                if i < bytes.len() {
                    i += 1;
                }
                if i < bytes.len() && bytes[i] == b'\\' {
                    i += 1;
                }
            } else if i < bytes.len() {
                i += 1;
            }
        } else if bytes[i] >= 0x20 || bytes[i] == b'\n' {
            out.push(bytes[i]);
            i += 1;
        } else {
            i += 1;
        }
    }

    String::from_utf8_lossy(&out).trim().to_string()
}

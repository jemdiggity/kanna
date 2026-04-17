use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use crate::pty::PtySession;
use crate::sidecar::TerminalSidecar;
use kanna_daemon::protocol::{AgentProvider, SessionInfo, SessionState, SessionStatus};

#[derive(Clone)]
pub struct StreamControl {
    stop_requested: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
}

impl StreamControl {
    pub fn new() -> Self {
        Self {
            stop_requested: Arc::new(AtomicBool::new(false)),
            stopped: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn request_stop(&self) {
        self.stop_requested.store(true, Ordering::SeqCst);
    }

    pub fn stop_requested(&self) -> bool {
        self.stop_requested.load(Ordering::SeqCst)
    }

    pub fn mark_stopped(&self) {
        self.stopped.store(true, Ordering::SeqCst);
    }

    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }
}

pub struct SessionRecord {
    pub pty: PtySession,
    pub sidecar: TerminalSidecar,
    pub stream_control: Option<StreamControl>,
    pub agent_provider: Option<AgentProvider>,
    pub status: SessionStatus,
    pub status_observed: bool,
}

pub struct SessionManager {
    pub sessions: HashMap<String, SessionRecord>,
}

pub struct StatusObservation {
    pub provider: Option<AgentProvider>,
    pub detected_status: Option<SessionStatus>,
    pub lines: Vec<String>,
}

impl SessionManager {
    pub fn new() -> Self {
        SessionManager {
            sessions: HashMap::new(),
        }
    }

    pub fn insert(&mut self, session_id: String, session: SessionRecord) {
        self.sessions.insert(session_id, session);
    }

    pub fn get_mut(&mut self, session_id: &str) -> Option<&mut SessionRecord> {
        self.sessions.get_mut(session_id)
    }

    pub fn remove(&mut self, session_id: &str) -> Option<SessionRecord> {
        self.sessions.remove(session_id)
    }

    pub fn contains(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    pub fn list(&mut self) -> Vec<SessionInfo> {
        self.sessions
            .iter_mut()
            .map(|(id, session)| {
                let state = match session.pty.try_wait() {
                    Some(code) => SessionState::Exited(code),
                    None => SessionState::Active,
                };
                let idle_seconds = session.pty.last_active_at.elapsed().as_secs();
                SessionInfo {
                    session_id: id.clone(),
                    pid: session.pty.pid(),
                    cwd: session.pty.cwd.clone(),
                    state,
                    idle_seconds,
                    status: session.status,
                }
            })
            .collect()
    }

    pub fn update_status(&mut self, session_id: &str, status: SessionStatus) -> bool {
        match self.sessions.get_mut(session_id) {
            Some(session) if session.status != status => {
                session.status = status;
                true
            }
            Some(_) => false,
            None => false,
        }
    }

    pub fn resize(
        &mut self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        match self.sessions.get_mut(session_id) {
            Some(session) => {
                session.pty.resize(cols, rows)?;
                session.sidecar.resize(cols, rows)?;
                Ok(())
            }
            None => Err(format!("session not found: {}", session_id).into()),
        }
    }

    pub fn signal(&self, session_id: &str, sig: i32) -> std::io::Result<()> {
        match self.sessions.get(session_id) {
            Some(session) => session.pty.signal(sig),
            None => Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("session not found: {}", session_id),
            )),
        }
    }

    pub fn mirror_output(
        &mut self,
        session_id: &str,
        data: &[u8],
        allow_sidecar_replies: bool,
    ) -> Result<Option<SessionStatus>, Box<dyn std::error::Error + Send + Sync>> {
        match self.sessions.get_mut(session_id) {
            Some(session) => {
                session.sidecar.write(data);
                if allow_sidecar_replies {
                    for reply in session.sidecar.drain_pty_writes() {
                        session.pty.write_input(&reply)?;
                    }
                } else {
                    session.sidecar.drain_pty_writes();
                }
                let next_status = session.sidecar.visible_status(session.agent_provider)?;
                if next_status.is_some() {
                    session.status_observed = true;
                }
                Ok(match next_status {
                    Some(status) if session.status != status => Some(status),
                    _ => None,
                })
            }
            None => Err(format!("session not found: {}", session_id).into()),
        }
    }

    pub fn refresh_quiet_status(
        &mut self,
        session_id: &str,
        quiet_for: std::time::Duration,
    ) -> Result<Option<SessionStatus>, Box<dyn std::error::Error + Send + Sync>> {
        let Some(session) = self.sessions.get_mut(session_id) else {
            return Ok(None);
        };

        if session.pty.last_active_at.elapsed() < quiet_for {
            return Ok(None);
        }

        let visible_status = session.sidecar.visible_status(session.agent_provider)?;
        if let Some(status) = visible_status {
            session.status_observed = true;
            return Ok(if session.status != status {
                Some(status)
            } else {
                None
            });
        }

        Ok(
            if session.status_observed
                && matches!(session.status, SessionStatus::Busy | SessionStatus::Waiting)
            {
                Some(SessionStatus::Idle)
            } else {
                None
            },
        )
    }

    pub fn debug_status_observation(
        &mut self,
        session_id: &str,
    ) -> Result<Option<StatusObservation>, Box<dyn std::error::Error + Send + Sync>> {
        let Some(session) = self.sessions.get_mut(session_id) else {
            return Ok(None);
        };

        Ok(Some(StatusObservation {
            provider: session.agent_provider,
            detected_status: session.sidecar.visible_status(session.agent_provider)?,
            lines: session.sidecar.debug_lines(8)?,
        }))
    }

    pub fn kill_all(&mut self) {
        for (id, session) in self.sessions.iter_mut() {
            if let Err(e) = session.pty.kill() {
                eprintln!("failed to kill session {}: {}", id, e);
            }
        }
        self.sessions.clear();
    }

    #[allow(dead_code)]
    pub fn session_ids(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    use super::{SessionManager, SessionRecord};
    use crate::pty::PtySession;
    use crate::sidecar::TerminalSidecar;
    use kanna_daemon::protocol::{AgentProvider, SessionStatus};

    fn spawn_test_record(
        provider: AgentProvider,
        status: SessionStatus,
    ) -> Result<SessionRecord, Box<dyn std::error::Error + Send + Sync>> {
        let pty = PtySession::spawn(
            "/bin/sh",
            &[String::from("-c"), String::from("sleep 10")],
            "/tmp",
            &HashMap::new(),
            80,
            24,
        )?;

        Ok(SessionRecord {
            pty,
            sidecar: TerminalSidecar::new(80, 24, 10_000)?,
            stream_control: None,
            agent_provider: Some(provider),
            status,
            status_observed: false,
        })
    }

    #[test]
    fn copilot_startup_busy_does_not_quiet_idle_before_provider_ui_is_visible() {
        let mut manager = SessionManager::new();
        let mut record = spawn_test_record(AgentProvider::Copilot, SessionStatus::Busy).unwrap();
        record.pty.last_active_at = Instant::now() - Duration::from_millis(500);
        manager.insert("copilot".to_string(), record);

        let status = manager
            .refresh_quiet_status("copilot", Duration::from_millis(150))
            .unwrap();

        assert_eq!(status, None);

        manager
            .remove("copilot")
            .expect("session should exist")
            .pty
            .kill()
            .unwrap();
    }

    #[test]
    fn quiet_refresh_returns_idle_after_busy_footer_disappears() {
        let mut manager = SessionManager::new();
        let mut record = spawn_test_record(AgentProvider::Codex, SessionStatus::Busy).unwrap();
        record.status_observed = true;
        record.sidecar.write("Header\r\nDone".as_bytes());
        record.pty.last_active_at = Instant::now() - Duration::from_millis(500);
        manager.insert("codex".to_string(), record);

        let status = manager
            .refresh_quiet_status("codex", Duration::from_millis(150))
            .unwrap();

        assert_eq!(status, Some(SessionStatus::Idle));

        manager
            .remove("codex")
            .expect("session should exist")
            .pty
            .kill()
            .unwrap();
    }

    #[test]
    fn debug_status_observation_reports_detected_status_and_lines() {
        let mut manager = SessionManager::new();
        let mut record = spawn_test_record(AgentProvider::Copilot, SessionStatus::Idle).unwrap();
        record.sidecar.write("Header\r\n(Esc to cancel)".as_bytes());
        manager.insert("copilot".to_string(), record);

        let observation = manager
            .debug_status_observation("copilot")
            .unwrap()
            .unwrap();

        assert_eq!(observation.detected_status, Some(SessionStatus::Busy));
        assert_eq!(observation.provider, Some(AgentProvider::Copilot));
        assert!(observation
            .lines
            .iter()
            .any(|line| line.contains("Esc to cancel")));

        manager
            .remove("copilot")
            .expect("session should exist")
            .pty
            .kill()
            .unwrap();
    }
}

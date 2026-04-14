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
}

pub struct SessionManager {
    pub sessions: HashMap<String, SessionRecord>,
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
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
                Ok(())
            }
            None => Err(format!("session not found: {}", session_id).into()),
        }
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

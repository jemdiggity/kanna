use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};

use crate::protocol::{RecoveryCommand, RecoveryResponse};
use crate::session_mirror::SessionMirror;
use crate::snapshot_store::SnapshotStore;

pub struct RecoveryService {
    snapshot_store: SnapshotStore,
    sessions: HashMap<String, SessionMirror>,
    stopping: bool,
}

impl RecoveryService {
    pub fn new(snapshot_store: SnapshotStore) -> Self {
        Self {
            snapshot_store,
            sessions: HashMap::new(),
            stopping: false,
        }
    }

    pub fn run<R: Read, W: Write>(
        &mut self,
        input: R,
        mut output: W,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let reader = BufReader::new(input);
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }

            let response = match crate::protocol::parse_command(&line) {
                Ok(command) => self.handle_command(command),
                Err(message) => RecoveryResponse::Error { message },
            };

            output.write_all(
                crate::protocol::format_response(&response)
                    .map_err(std::io::Error::other)?
                    .as_bytes(),
            )?;
            output.flush()?;

            if self.stopping {
                break;
            }
        }

        Ok(())
    }

    pub fn handle_command(&mut self, command: RecoveryCommand) -> RecoveryResponse {
        match command {
            RecoveryCommand::StartSession {
                session_id,
                cols,
                rows,
                resume_from_disk,
            } => self.start_session(session_id, cols, rows, resume_from_disk),
            RecoveryCommand::WriteOutput {
                session_id,
                data,
                sequence,
            } => self.write_output(session_id, &data, sequence),
            RecoveryCommand::ResizeSession {
                session_id,
                cols,
                rows,
            } => self.resize_session(session_id, cols, rows),
            RecoveryCommand::EndSession { session_id } => self.end_session(session_id),
            RecoveryCommand::GetSnapshot { session_id } => self.get_snapshot(session_id),
            RecoveryCommand::FlushAndShutdown => self.flush_and_shutdown(),
        }
    }

    fn start_session(
        &mut self,
        session_id: String,
        cols: u16,
        rows: u16,
        resume_from_disk: bool,
    ) -> RecoveryResponse {
        if self.sessions.contains_key(&session_id) {
            return RecoveryResponse::Error {
                message: format!("Session already exists: {}", session_id),
            };
        }

        let mut mirror = match SessionMirror::new(session_id.clone(), cols, rows) {
            Ok(mirror) => mirror,
            Err(message) => return RecoveryResponse::Error { message },
        };

        if resume_from_disk {
            let snapshot = match self.snapshot_store.require(&session_id) {
                Ok(snapshot) => snapshot,
                Err(message) => return RecoveryResponse::Error { message },
            };
            if let Err(message) = mirror.restore(&snapshot) {
                return RecoveryResponse::Error { message };
            }
        } else if let Err(message) = self.snapshot_store.remove(&session_id) {
            return RecoveryResponse::Error { message };
        }

        self.sessions.insert(session_id, mirror);
        RecoveryResponse::Ok
    }

    fn write_output(&mut self, session_id: String, data: &[u8], sequence: u64) -> RecoveryResponse {
        let Some(mirror) = self.sessions.get_mut(&session_id) else {
            return RecoveryResponse::Error {
                message: format!("Unknown session: {}", session_id),
            };
        };

        mirror.write_output(data, sequence);
        match mirror.snapshot() {
            Ok(snapshot) => match self.snapshot_store.write(&snapshot) {
                Ok(()) => RecoveryResponse::Ok,
                Err(message) => RecoveryResponse::Error { message },
            },
            Err(message) => RecoveryResponse::Error { message },
        }
    }

    fn resize_session(&mut self, session_id: String, cols: u16, rows: u16) -> RecoveryResponse {
        let Some(mirror) = self.sessions.get_mut(&session_id) else {
            return RecoveryResponse::Error {
                message: format!("Unknown session: {}", session_id),
            };
        };

        if let Err(message) = mirror.resize(cols, rows) {
            return RecoveryResponse::Error { message };
        }

        match mirror.snapshot() {
            Ok(snapshot) => match self.snapshot_store.write(&snapshot) {
                Ok(()) => RecoveryResponse::Ok,
                Err(message) => RecoveryResponse::Error { message },
            },
            Err(message) => RecoveryResponse::Error { message },
        }
    }

    fn end_session(&mut self, session_id: String) -> RecoveryResponse {
        self.sessions.remove(&session_id);
        match self.snapshot_store.remove(&session_id) {
            Ok(()) => RecoveryResponse::Ok,
            Err(message) => RecoveryResponse::Error { message },
        }
    }

    fn get_snapshot(&mut self, session_id: String) -> RecoveryResponse {
        if let Some(mirror) = self.sessions.get_mut(&session_id) {
            return match mirror.snapshot() {
                Ok(snapshot) => RecoveryResponse::from_snapshot(snapshot),
                Err(message) => RecoveryResponse::Error { message },
            };
        }

        match self.snapshot_store.read(&session_id) {
            Ok(Some(snapshot)) => RecoveryResponse::from_snapshot(snapshot),
            Ok(None) => RecoveryResponse::NotFound,
            Err(message) => RecoveryResponse::Error { message },
        }
    }

    fn flush_and_shutdown(&mut self) -> RecoveryResponse {
        for mirror in self.sessions.values_mut() {
            let snapshot = match mirror.snapshot() {
                Ok(snapshot) => snapshot,
                Err(message) => return RecoveryResponse::Error { message },
            };
            if let Err(message) = self.snapshot_store.write(&snapshot) {
                return RecoveryResponse::Error { message };
            }
        }
        self.stopping = true;
        RecoveryResponse::Ok
    }
}

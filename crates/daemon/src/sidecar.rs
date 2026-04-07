use std::{cell::RefCell, rc::Rc};

use ghostty_xterm_compat_serialize::serialize_terminal;
use libghostty_vt::{terminal::Mode, Terminal, TerminalOptions};

use crate::protocol::TerminalSnapshot;

type SidecarResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub struct TerminalSidecar {
    terminal: Box<Terminal<'static, 'static>>,
    pty_writes: Rc<RefCell<Vec<Vec<u8>>>>,
    rows: u16,
    cols: u16,
}

unsafe impl Send for TerminalSidecar {}

impl TerminalSidecar {
    fn normalize_dimensions(cols: u16, rows: u16) -> (u16, u16) {
        let normalized_cols = if cols == 0 { 80 } else { cols };
        let normalized_rows = if rows == 0 { 24 } else { rows };
        (normalized_cols, normalized_rows)
    }

    fn restore_vt(snapshot: &TerminalSnapshot) -> String {
        format!(
            "{}{}\x1b[{};{}H",
            snapshot.vt,
            if snapshot.cursor_visible {
                "\x1b[?25h"
            } else {
                "\x1b[?25l"
            },
            u32::from(snapshot.cursor_row) + 1,
            u32::from(snapshot.cursor_col) + 1,
        )
    }

    pub fn new(cols: u16, rows: u16, scrollback: usize) -> SidecarResult<Self> {
        let pty_writes = Rc::new(RefCell::new(Vec::new()));
        let mut terminal = Box::new(Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: scrollback,
        })?);
        terminal.on_pty_write({
            let pty_writes = Rc::clone(&pty_writes);
            move |_terminal, data| {
                pty_writes.borrow_mut().push(data.to_vec());
            }
        })?;

        Ok(Self {
            terminal,
            pty_writes,
            rows,
            cols,
        })
    }

    pub fn write(&mut self, bytes: &[u8]) {
        self.terminal.vt_write(bytes);
    }

    pub fn drain_pty_writes(&mut self) -> Vec<Vec<u8>> {
        self.pty_writes.borrow_mut().drain(..).collect()
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> SidecarResult<()> {
        self.terminal.resize(cols, rows, 1, 1)?;
        self.cols = cols;
        self.rows = rows;
        Ok(())
    }

    pub fn snapshot(&mut self) -> SidecarResult<TerminalSnapshot> {
        let had_synchronized_output = self.terminal.mode(Mode::SYNC_OUTPUT)?;
        if had_synchronized_output {
            self.terminal.set_mode(Mode::SYNC_OUTPUT, false)?;
        }
        let vt = serialize_terminal(&self.terminal, None)
            .map_err(|error| std::io::Error::other(error.to_string()))?
            .serialized_candidate;
        if had_synchronized_output {
            self.terminal.set_mode(Mode::SYNC_OUTPUT, true)?;
        }

        Ok(TerminalSnapshot {
            version: 1,
            rows: self.rows,
            cols: self.cols,
            cursor_row: self.terminal.cursor_y()?,
            cursor_col: self.terminal.cursor_x()?,
            cursor_visible: self.terminal.is_cursor_visible()?,
            vt,
        })
    }

    pub fn from_snapshot(snapshot: &TerminalSnapshot, scrollback: usize) -> SidecarResult<Self> {
        let mut sidecar = Self::new(snapshot.cols, snapshot.rows, scrollback)?;
        sidecar.write(Self::restore_vt(snapshot).as_bytes());
        Ok(sidecar)
    }

    pub fn from_handoff(
        snapshot: Option<&TerminalSnapshot>,
        cols: u16,
        rows: u16,
        scrollback: usize,
    ) -> SidecarResult<Self> {
        let (cols, rows) = Self::normalize_dimensions(cols, rows);
        match snapshot {
            Some(snapshot) => match Self::from_snapshot(snapshot, scrollback) {
                Ok(sidecar) => Ok(sidecar),
                Err(error) => {
                    log::warn!(
                        "[handoff] failed to restore sidecar from snapshot rows={} cols={}: {}",
                        snapshot.rows,
                        snapshot.cols,
                        error
                    );
                    Self::new(cols, rows, scrollback)
                }
            },
            None => Self::new(cols, rows, scrollback),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{TerminalSidecar, TerminalSnapshot};

    #[test]
    fn sidecar_snapshot_tracks_output_and_resize() {
        let mut sidecar = TerminalSidecar::new(80, 24, 10_000).unwrap();
        sidecar.write(b"abc");
        sidecar.resize(100, 30).unwrap();
        let snapshot = sidecar.snapshot().unwrap();

        assert_eq!(snapshot.rows, 30);
        assert_eq!(snapshot.cols, 100);
        assert!(snapshot.vt.contains("abc"));
    }

    #[test]
    fn sidecar_survives_move_after_callback_registration() {
        let mut by_id = HashMap::new();
        by_id.insert(
            "session".to_string(),
            TerminalSidecar::new(80, 24, 10_000).unwrap(),
        );

        let sidecar = by_id.get_mut("session").unwrap();
        sidecar.write(b"\x1b[>q");

        let replies = sidecar.drain_pty_writes();
        assert!(!replies.is_empty());
    }

    #[test]
    fn sidecar_restores_from_snapshot() {
        let snapshot = TerminalSnapshot {
            version: 1,
            rows: 24,
            cols: 80,
            cursor_row: 1,
            cursor_col: 2,
            cursor_visible: true,
            vt: "hello".to_string(),
        };

        let mut sidecar = TerminalSidecar::from_snapshot(&snapshot, 10_000).unwrap();
        let restored = sidecar.snapshot().unwrap();

        assert_eq!(restored.rows, 24);
        assert_eq!(restored.cols, 80);
        assert!(restored.vt.contains("hello"));
        assert_eq!(restored.cursor_row, 1);
        assert_eq!(restored.cursor_col, 2);
    }

    #[test]
    fn sidecar_snapshot_tracks_cursor_visibility_and_strips_sync_output() {
        let mut sidecar = TerminalSidecar::new(80, 24, 10_000).unwrap();
        sidecar.write(b"\x1b[?25l\x1b[?2026hhello");

        let snapshot = sidecar.snapshot().unwrap();

        assert!(!snapshot.cursor_visible);
        assert!(!snapshot.vt.contains("\x1b[?2026h"));
    }

    #[test]
    fn handoff_snapshot_restore_falls_back_to_blank_sidecar() {
        let snapshot = TerminalSnapshot {
            version: 1,
            rows: 0,
            cols: 0,
            cursor_row: 0,
            cursor_col: 0,
            cursor_visible: true,
            vt: "ignored".to_string(),
        };

        assert!(TerminalSidecar::from_snapshot(&snapshot, 10_000).is_err());

        let mut sidecar = TerminalSidecar::from_handoff(Some(&snapshot), 120, 45, 10_000).unwrap();
        sidecar.write(b"hello");
        let restored = sidecar.snapshot().unwrap();

        assert_eq!(restored.cols, 120);
        assert_eq!(restored.rows, 45);
        assert!(restored.vt.contains("hello"));
    }

    #[test]
    fn handoff_without_snapshot_falls_back_to_default_dimensions() {
        let mut sidecar = TerminalSidecar::from_handoff(None, 0, 0, 10_000).unwrap();
        sidecar.write(b"hello");
        let restored = sidecar.snapshot().unwrap();

        assert_eq!(restored.cols, 80);
        assert_eq!(restored.rows, 24);
        assert!(restored.vt.contains("hello"));
    }
}

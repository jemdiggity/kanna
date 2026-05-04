use ghostty_xterm_compat_serialize::serialize_terminal;
use libghostty_vt::{Terminal, TerminalOptions};

use crate::protocol::RecoverySnapshot;

const SCROLLBACK_LIMIT: usize = 10_000;
// Ghostty's C API names this "max_scrollback", but it is a byte budget, not a
// row count. Budget against the full grid so 10K logical rows survive snapshot.
const GHOSTTY_SCROLLBACK_BYTES_PER_CELL: usize = 20;

pub struct SessionMirror {
    session_id: String,
    terminal: Terminal<'static, 'static>,
    cols: u16,
    rows: u16,
    sequence: u64,
}

impl SessionMirror {
    pub fn new(session_id: impl Into<String>, cols: u16, rows: u16) -> Result<Self, String> {
        let terminal = Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: scrollback_byte_limit(cols, rows, SCROLLBACK_LIMIT),
        })
        .map_err(|error| format!("failed to create terminal mirror: {}", error))?;

        Ok(Self {
            session_id: session_id.into(),
            terminal,
            cols,
            rows,
            sequence: 0,
        })
    }

    pub fn write_output(&mut self, data: &[u8], sequence: u64) {
        self.terminal.vt_write(data);
        self.sequence = sequence;
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        self.terminal
            .resize(cols, rows, 0, 0)
            .map_err(|error| format!("failed to resize terminal mirror: {}", error))?;
        self.cols = cols;
        self.rows = rows;
        Ok(())
    }

    pub fn restore(&mut self, snapshot: &RecoverySnapshot) -> Result<(), String> {
        self.terminal.reset();
        self.terminal
            .resize(snapshot.cols, snapshot.rows, 0, 0)
            .map_err(|error| format!("failed to resize terminal mirror: {}", error))?;
        self.cols = snapshot.cols;
        self.rows = snapshot.rows;
        self.sequence = snapshot.sequence;
        self.terminal.vt_write(snapshot.serialized.as_bytes());

        let cursor = format!(
            "\u{1b}[{};{}H{}",
            snapshot.cursor_row + 1,
            snapshot.cursor_col + 1,
            if snapshot.cursor_visible {
                "\u{1b}[?25h"
            } else {
                "\u{1b}[?25l"
            }
        );
        self.terminal.vt_write(cursor.as_bytes());
        Ok(())
    }

    pub fn snapshot(&self) -> Result<RecoverySnapshot, String> {
        let serialized = serialize_terminal(&self.terminal, None)
            .map_err(|error| format!("failed to serialize terminal mirror: {}", error))?;

        Ok(RecoverySnapshot {
            session_id: self.session_id.clone(),
            serialized: serialized.serialized_candidate,
            cols: self.cols,
            rows: self.rows,
            cursor_row: serialized.cursor_y,
            cursor_col: serialized.cursor_x,
            cursor_visible: self
                .terminal
                .is_cursor_visible()
                .map_err(|error| format!("failed to inspect cursor visibility: {}", error))?,
            saved_at: now_millis(),
            sequence: self.sequence,
        })
    }
}

pub fn scrollback_byte_limit(cols: u16, rows: u16, scrollback_rows: usize) -> usize {
    usize::from(cols)
        .saturating_mul(usize::from(rows).saturating_add(scrollback_rows))
        .saturating_mul(GHOSTTY_SCROLLBACK_BYTES_PER_CELL)
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

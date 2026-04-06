use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub session_id: String,
    pub serialized: String,
    pub cols: u16,
    pub rows: u16,
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub cursor_visible: bool,
    pub saved_at: u64,
    pub sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum RecoveryCommand {
    StartSession {
        #[serde(rename = "sessionId")]
        session_id: String,
        cols: u16,
        rows: u16,
        #[serde(rename = "resumeFromDisk")]
        #[serde(default)]
        resume_from_disk: bool,
    },
    WriteOutput {
        #[serde(rename = "sessionId")]
        session_id: String,
        data: Vec<u8>,
        sequence: u64,
    },
    ResizeSession {
        #[serde(rename = "sessionId")]
        session_id: String,
        cols: u16,
        rows: u16,
    },
    EndSession {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    GetSnapshot {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    FlushAndShutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum RecoveryResponse {
    Ok,
    Error {
        message: String,
    },
    Snapshot {
        #[serde(rename = "sessionId")]
        session_id: String,
        serialized: String,
        cols: u16,
        rows: u16,
        #[serde(rename = "cursorRow")]
        cursor_row: u16,
        #[serde(rename = "cursorCol")]
        cursor_col: u16,
        #[serde(rename = "cursorVisible")]
        cursor_visible: bool,
        #[serde(rename = "savedAt")]
        saved_at: u64,
        sequence: u64,
    },
    NotFound,
}

impl RecoveryResponse {
    pub fn from_snapshot(snapshot: RecoverySnapshot) -> Self {
        Self::Snapshot {
            session_id: snapshot.session_id,
            serialized: snapshot.serialized,
            cols: snapshot.cols,
            rows: snapshot.rows,
            cursor_row: snapshot.cursor_row,
            cursor_col: snapshot.cursor_col,
            cursor_visible: snapshot.cursor_visible,
            saved_at: snapshot.saved_at,
            sequence: snapshot.sequence,
        }
    }
}

pub fn parse_command(line: &str) -> Result<RecoveryCommand, String> {
    serde_json::from_str(line).map_err(|error| format!("Invalid JSON: {}", error))
}

pub fn format_response(response: &RecoveryResponse) -> Result<String, String> {
    let mut json = serde_json::to_string(response)
        .map_err(|error| format!("failed to serialize response: {}", error))?;
    json.push('\n');
    Ok(json)
}

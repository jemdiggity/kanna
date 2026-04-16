use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

use crate::daemon_client::DaemonClient;

pub type DaemonState = Arc<Mutex<Option<DaemonClient>>>;
pub type AttachedSessions = Arc<Mutex<HashSet<String>>>;
pub type PendingAttachedStreams = Arc<Mutex<HashMap<String, DaemonClient>>>;
pub type ActiveAttachedStreams = Arc<Mutex<HashMap<String, ActiveAttachedStream>>>;

pub struct ActiveAttachedStream {
    attach_id: u64,
    shutdown: tokio::sync::oneshot::Sender<()>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DaemonCommandError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl From<String> for DaemonCommandError {
    fn from(message: String) -> Self {
        Self {
            message,
            code: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TerminalSnapshotPayload {
    pub version: u32,
    pub rows: u16,
    pub cols: u16,
    pub cursor_row: u16,
    pub cursor_col: u16,
    #[serde(default = "default_cursor_visible")]
    pub cursor_visible: bool,
    pub vt: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SessionRecoveryStatePayload {
    pub serialized: String,
    pub cols: u16,
    pub rows: u16,
    #[serde(rename = "savedAt")]
    pub saved_at: u64,
    pub sequence: u64,
}

fn default_cursor_visible() -> bool {
    true
}

static NEXT_ATTACH_ID: AtomicU64 = AtomicU64::new(1);
/// Read the Ok/Error ack while already holding the lock.
fn parse_error_event(event: &serde_json::Value) -> DaemonCommandError {
    DaemonCommandError {
        message: event
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("daemon error")
            .to_string(),
        code: event
            .get("code")
            .and_then(|c| c.as_str())
            .map(std::string::ToString::to_string),
    }
}

fn parse_ack(response: &str) -> Result<(), DaemonCommandError> {
    let event: serde_json::Value = serde_json::from_str(response).unwrap_or_default();
    if let Some("Error") = event.get("type").and_then(|t| t.as_str()) {
        return Err(parse_error_event(&event));
    }
    Ok(())
}

fn parse_agent_provider(
    agent_provider: Option<String>,
) -> Result<Option<String>, DaemonCommandError> {
    match agent_provider.as_deref() {
        Some("claude") | Some("copilot") | Some("codex") => Ok(agent_provider),
        Some(other) => Err(DaemonCommandError {
            message: format!("unsupported agent provider: {other}"),
            code: None,
        }),
        None => Ok(None),
    }
}

fn parse_snapshot_response(response: &str) -> Result<TerminalSnapshotPayload, DaemonCommandError> {
    let event: serde_json::Value =
        serde_json::from_str(response).map_err(|e| DaemonCommandError {
            message: format!("failed to parse event: {}", e),
            code: None,
        })?;

    match event.get("type").and_then(|t| t.as_str()) {
        Some("Snapshot") => {
            serde_json::from_value(event.get("snapshot").cloned().ok_or_else(|| {
                DaemonCommandError {
                    message: "snapshot response missing payload".to_string(),
                    code: None,
                }
            })?)
            .map_err(|e| DaemonCommandError {
                message: format!("failed to parse snapshot payload: {}", e),
                code: None,
            })
        }
        Some("Error") => Err(parse_error_event(&event)),
        _ => Err(DaemonCommandError {
            message: format!("unexpected event: {}", response),
            code: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_snapshot_response, require_option_mut, TerminalSnapshotPayload};

    #[test]
    fn parse_snapshot_response_defaults_cursor_visible_for_older_payloads() {
        let response = r#"{
            "type":"Snapshot",
            "session_id":"sess-1",
            "snapshot":{
                "version":1,
                "rows":24,
                "cols":80,
                "cursor_row":10,
                "cursor_col":5,
                "vt":"hello"
            }
        }"#;

        let snapshot = parse_snapshot_response(response).expect("snapshot should parse");

        assert_eq!(
            snapshot,
            TerminalSnapshotPayload {
                version: 1,
                rows: 24,
                cols: 80,
                cursor_row: 10,
                cursor_col: 5,
                cursor_visible: true,
                vt: "hello".to_string(),
            }
        );
    }

    #[test]
    fn require_option_mut_returns_error_when_missing() {
        let mut value: Option<u8> = None;
        let error = require_option_mut(&mut value, "daemon client")
            .expect_err("missing option should return an error");
        assert_eq!(error, "daemon client unavailable");
    }
}

fn daemon_socket_path() -> PathBuf {
    crate::daemon_socket_path()
}

async fn ensure_connected(state: &DaemonState) -> Result<(), String> {
    let mut guard = state.lock().await;
    if guard.is_none() {
        let socket_path = daemon_socket_path();
        let client = DaemonClient::connect(&socket_path).await?;
        *guard = Some(client);
    }
    Ok(())
}

async fn spawn_attached_stream_task(
    app: tauri::AppHandle,
    stream_client: DaemonClient,
    session_id: String,
    attached: AttachedSessions,
    active_streams: ActiveAttachedStreams,
) {
    attached.lock().await.insert(session_id.clone());
    let attach_id = NEXT_ATTACH_ID.fetch_add(1, Ordering::Relaxed);
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
    if let Some(previous) = active_streams.lock().await.insert(
        session_id.clone(),
        ActiveAttachedStream {
            attach_id,
            shutdown: shutdown_tx,
        },
    ) {
        let _ = previous.shutdown.send(());
    }

    let sid = session_id.clone();
    let app = app.clone();
    let attached_clone = attached.clone();
    let active_streams_clone = active_streams.clone();
    tauri::async_runtime::spawn(async move {
        let mut exited_normally = false;
        let mut detached_intentionally = false;
        let mut output_event_count: usize = 0;
        let mut stream_client = stream_client;

        loop {
            let line = tokio::select! {
                _ = &mut shutdown_rx => {
                    detached_intentionally = true;
                    if let Ok(cmd) = serde_json::to_string(&serde_json::json!({
                        "type": "Detach",
                        "session_id": &sid,
                    })) {
                        let _ = stream_client.send_command(&cmd).await;
                        if let Ok(response) = stream_client.read_event().await {
                            let _ = parse_ack(&response);
                        }
                    }
                    break;
                }
                line = stream_client.read_event() => match line {
                    Ok(line) => line,
                    Err(_) => break,
                }
            };
            let event: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            match event.get("type").and_then(|t| t.as_str()) {
                Some("Output") => {
                    output_event_count += 1;
                    if output_event_count <= 5 {
                        let byte_len = event
                            .get("data")
                            .and_then(|d| d.as_array())
                            .map(|d| d.len())
                            .unwrap_or(0);
                        eprintln!(
                            "[attach] output session={} chunk={} bytes={}",
                            sid, output_event_count, byte_len
                        );
                    }
                    if let Some(data) = event.get("data").and_then(|d| d.as_array()) {
                        let bytes: Vec<u8> = data
                            .iter()
                            .filter_map(|v| v.as_u64().map(|n| n as u8))
                            .collect();
                        use base64::Engine;
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        let payload = serde_json::json!({
                            "session_id": event.get("session_id"),
                            "data_b64": b64,
                        });
                        let _ = app.emit("terminal_output", &payload);
                    } else {
                        let _ = app.emit("terminal_output", &event);
                    }
                }
                Some("Exit") => {
                    attached_clone.lock().await.remove(&sid);
                    eprintln!("[attach] exit event session={}", sid);
                    let _ = app.emit("session_exit", &event);
                    exited_normally = true;
                    break;
                }
                Some("StatusChanged") => {
                    let _ = app.emit("status_changed", &event);
                }
                _ => {}
            }
        }
        attached_clone.lock().await.remove(&sid);
        let removed = active_streams_clone.lock().await.remove(&sid);
        if removed
            .as_ref()
            .is_some_and(|stream| stream.attach_id != attach_id)
        {
            if let Some(stream) = removed {
                active_streams_clone
                    .lock()
                    .await
                    .insert(sid.clone(), stream);
            }
        }
        if !exited_normally && !detached_intentionally {
            let payload = serde_json::json!({
                "session_id": &sid,
            });
            let _ = app.emit("session_stream_lost", &payload);
            eprintln!("[attach] emitted session_stream_lost session={}", sid);
        }
        eprintln!("[attach] output stream ended for session {}", sid);
    });
}

fn require_option_mut<'a, T>(value: &'a mut Option<T>, context: &str) -> Result<&'a mut T, String> {
    value
        .as_mut()
        .ok_or_else(|| format!("{context} unavailable"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn spawn_session(
    state: tauri::State<'_, DaemonState>,
    session_id: String,
    cwd: String,
    executable: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
    agent_provider: Option<String>,
) -> Result<(), DaemonCommandError> {
    let agent_provider = parse_agent_provider(agent_provider)?;
    let cmd = serde_json::json!({
        "type": "Spawn",
        "session_id": session_id,
        "cwd": cwd,
        "executable": executable,
        "args": args,
        "env": env,
        "cols": cols,
        "rows": rows,
        "agent_provider": agent_provider,
    });
    let json = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    ensure_connected(&state).await?;
    let mut guard = state.lock().await;
    let client = require_option_mut(&mut guard, "daemon client")?;
    client.send_command(&json).await?;

    // Read response — expect SessionCreated or Error
    let response = client.read_event().await?;
    let event: serde_json::Value =
        serde_json::from_str(&response).map_err(|e| format!("bad response: {}", e))?;
    match event.get("type").and_then(|t| t.as_str()) {
        Some("SessionCreated") => Ok(()),
        Some("Error") => Err(parse_error_event(&event)),
        _ => Err(DaemonCommandError {
            message: format!("unexpected spawn response: {}", response),
            code: None,
        }),
    }
}

#[tauri::command]
pub async fn get_session_recovery_state(
    state: tauri::State<'_, DaemonState>,
    session_id: String,
) -> Result<Option<SessionRecoveryStatePayload>, DaemonCommandError> {
    let cmd = serde_json::json!({
        "type": "Snapshot",
        "session_id": session_id,
    });
    let json = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    ensure_connected(&state).await?;
    let mut guard = state.lock().await;
    let client = require_option_mut(&mut guard, "daemon client")?;
    client.send_command(&json).await?;
    let response = client.read_event().await?;
    match parse_snapshot_response(&response) {
        Ok(snapshot) => Ok(Some(SessionRecoveryStatePayload {
            serialized: snapshot.vt,
            cols: snapshot.cols,
            rows: snapshot.rows,
            saved_at: 0,
            sequence: 0,
        })),
        Err(message) if message.code.as_deref() == Some("session_not_found") => Ok(None),
        Err(message) => Err(message),
    }
}

#[tauri::command]
pub async fn send_input(
    state: tauri::State<'_, DaemonState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), DaemonCommandError> {
    let cmd = serde_json::json!({
        "type": "Input",
        "session_id": session_id,
        "data": data,
    });
    let json = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    ensure_connected(&state).await?;
    let mut guard = state.lock().await;
    let client = require_option_mut(&mut guard, "daemon client")?;
    client.send_command(&json).await?;
    let response = client.read_event().await?;
    parse_ack(&response)
}

#[tauri::command]
pub async fn resize_session(
    state: tauri::State<'_, DaemonState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), DaemonCommandError> {
    let cmd = serde_json::json!({
        "type": "Resize",
        "session_id": session_id,
        "cols": cols,
        "rows": rows,
    });
    let json = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    ensure_connected(&state).await?;
    let mut guard = state.lock().await;
    let client = require_option_mut(&mut guard, "daemon client")?;
    client.send_command(&json).await?;
    let response = client.read_event().await?;
    parse_ack(&response)
}

#[tauri::command]
pub async fn signal_session(
    state: tauri::State<'_, DaemonState>,
    session_id: String,
    signal: String,
) -> Result<(), DaemonCommandError> {
    let cmd = serde_json::json!({
        "type": "Signal",
        "session_id": session_id,
        "signal": signal,
    });
    let json = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    ensure_connected(&state).await?;
    let mut guard = state.lock().await;
    let client = require_option_mut(&mut guard, "daemon client")?;
    client.send_command(&json).await?;
    let response = client.read_event().await?;
    parse_ack(&response)
}

#[tauri::command]
pub async fn kill_session(
    state: tauri::State<'_, DaemonState>,
    session_id: String,
) -> Result<(), DaemonCommandError> {
    let cmd = serde_json::json!({
        "type": "Kill",
        "session_id": session_id,
    });
    let json = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    ensure_connected(&state).await?;
    let mut guard = state.lock().await;
    let client = require_option_mut(&mut guard, "daemon client")?;
    client.send_command(&json).await?;
    let response = client.read_event().await?;
    parse_ack(&response)
}

#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, DaemonState>,
) -> Result<Vec<serde_json::Value>, DaemonCommandError> {
    let cmd = serde_json::json!({ "type": "List" });
    let json = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    ensure_connected(&state).await?;
    let mut guard = state.lock().await;
    let client = guard.as_mut().unwrap();
    client.send_command(&json).await?;
    let response = client.read_event().await?;

    let event: serde_json::Value =
        serde_json::from_str(&response).map_err(|e| format!("failed to parse event: {}", e))?;

    match event.get("type").and_then(|t| t.as_str()) {
        Some("SessionList") => {
            let sessions = event
                .get("sessions")
                .and_then(|s| s.as_array())
                .cloned()
                .unwrap_or_default();
            Ok(sessions)
        }
        Some("Error") => Err(parse_error_event(&event)),
        _ => Err(DaemonCommandError {
            message: format!("unexpected event: {}", response),
            code: None,
        }),
    }
}

pub async fn attach_session_inner(
    app: &tauri::AppHandle,
    session_id: String,
    attached: &AttachedSessions,
    active_streams: &ActiveAttachedStreams,
    agent_provider: Option<String>,
) -> Result<(), DaemonCommandError> {
    eprintln!(
        "[attach] start session={} provider={:?}",
        session_id, agent_provider
    );
    // Create a dedicated connection for this session's output streaming.
    // This avoids mixing Output events with command responses.
    let socket_path = daemon_socket_path();
    let mut stream_client = DaemonClient::connect(&socket_path).await?;

    // Send Attach command
    let cmd = serde_json::json!({
        "type": "Attach",
        "session_id": session_id,
        "emulate_terminal": true,
    });
    stream_client
        .send_command(&serde_json::to_string(&cmd).unwrap())
        .await?;

    // Read the Ok/Error response
    let response = stream_client.read_event().await?;
    let event: serde_json::Value = serde_json::from_str(&response).map_err(|e| e.to_string())?;
    if let Some("Error") = event.get("type").and_then(|t| t.as_str()) {
        let error = parse_error_event(&event);
        eprintln!(
            "[attach] rejected session={} error={} code={:?}",
            session_id, error.message, error.code
        );
        return Err(error);
    }

    eprintln!("[attach] acknowledged session={}", session_id);
    spawn_attached_stream_task(
        app.clone(),
        stream_client,
        session_id,
        attached.clone(),
        active_streams.clone(),
    )
    .await;

    Ok(())
}

#[tauri::command]
pub async fn attach_session_with_snapshot(
    pending_streams: tauri::State<'_, PendingAttachedStreams>,
    session_id: String,
) -> Result<TerminalSnapshotPayload, DaemonCommandError> {
    let socket_path = daemon_socket_path();
    let mut stream_client = DaemonClient::connect(&socket_path).await?;
    let cmd = serde_json::json!({
        "type": "AttachSnapshot",
        "session_id": session_id,
        "emulate_terminal": true,
    });
    stream_client
        .send_command(&serde_json::to_string(&cmd).unwrap())
        .await?;

    let response = stream_client.read_event().await?;
    let snapshot = parse_snapshot_response(&response)?;
    pending_streams
        .lock()
        .await
        .insert(session_id.clone(), stream_client);
    Ok(snapshot)
}

#[tauri::command]
pub async fn resume_session_stream(
    app: tauri::AppHandle,
    pending_streams: tauri::State<'_, PendingAttachedStreams>,
    attached: tauri::State<'_, AttachedSessions>,
    active_streams: tauri::State<'_, ActiveAttachedStreams>,
    session_id: String,
    _agent_provider: Option<String>,
) -> Result<(), DaemonCommandError> {
    let stream_client = pending_streams
        .lock()
        .await
        .remove(&session_id)
        .ok_or_else(|| DaemonCommandError {
            message: format!("pending stream not found for {}", session_id),
            code: None,
        })?;
    spawn_attached_stream_task(
        app,
        stream_client,
        session_id,
        attached.inner().clone(),
        active_streams.inner().clone(),
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn attach_session(
    app: tauri::AppHandle,
    attached: tauri::State<'_, AttachedSessions>,
    active_streams: tauri::State<'_, ActiveAttachedStreams>,
    session_id: String,
    agent_provider: Option<String>,
) -> Result<(), DaemonCommandError> {
    attach_session_inner(&app, session_id, &attached, &active_streams, agent_provider).await
}

#[tauri::command]
pub async fn detach_session(
    attached: tauri::State<'_, AttachedSessions>,
    pending_streams: tauri::State<'_, PendingAttachedStreams>,
    active_streams: tauri::State<'_, ActiveAttachedStreams>,
    session_id: String,
) -> Result<(), DaemonCommandError> {
    attached.lock().await.remove(&session_id);
    if let Some(mut pending_stream) = pending_streams.lock().await.remove(&session_id) {
        let cmd = serde_json::to_string(&serde_json::json!({
            "type": "Detach",
            "session_id": session_id,
        }))
        .map_err(|e| DaemonCommandError {
            message: format!("failed to serialize detach command: {e}"),
            code: None,
        })?;
        pending_stream.send_command(&cmd).await?;
        let response = pending_stream.read_event().await?;
        parse_ack(&response)?;
    }
    if let Some(active_stream) = active_streams.lock().await.remove(&session_id) {
        let _ = active_stream.shutdown.send(());
    }
    Ok(())
}

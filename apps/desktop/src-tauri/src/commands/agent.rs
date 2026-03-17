use claude_agent_sdk::{Message, PermissionMode, Session, SessionOptions};
use dashmap::DashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// An agent session with a message buffer so messages aren't lost before the UI starts polling.
pub struct BufferedSession {
    session: Session,
    buffer: Mutex<Vec<serde_json::Value>>,
    finished: Mutex<bool>,
}

/// Shared state holding all active agent sessions, keyed by session ID.
pub type AgentState = Arc<DashMap<String, BufferedSession>>;

/// Create a new agent session, starting a Claude CLI process.
///
/// The session is stored in state and messages can be polled via `agent_next_message`.
#[tauri::command]
pub async fn create_agent_session(
    state: State<'_, AgentState>,
    session_id: String,
    cwd: String,
    prompt: String,
    system_prompt: Option<String>,
    model: Option<String>,
    allowed_tools: Option<Vec<String>>,
    max_turns: Option<u32>,
    permission_mode: Option<String>,
) -> Result<(), String> {
    let mut builder = SessionOptions::builder()
        .cwd(&cwd)
        .permission_mode(parse_permission_mode(permission_mode.as_deref()));

    if let Some(sp) = &system_prompt {
        builder = builder.system_prompt(sp);
    }

    if let Some(m) = &model {
        builder = builder.model(m);
    }

    if let Some(tools) = allowed_tools {
        builder = builder.allowed_tools(tools);
    }

    if let Some(mt) = max_turns {
        builder = builder.max_turns(mt);
    }

    let session = Session::start(builder.build(), &prompt)
        .await
        .map_err(|e| e.to_string())?;

    let buffered = BufferedSession {
        session,
        buffer: Mutex::new(Vec::new()),
        finished: Mutex::new(false),
    };

    // Spawn a background task to drain messages into the buffer
    let state_clone = state.inner().clone();
    let sid = session_id.clone();
    tokio::spawn(async move {
        loop {
            let msg = {
                let entry = state_clone.get(&sid);
                let Some(entry) = entry else { break };
                entry.session.next_message().await
            };
            match msg {
                Some(Ok(m)) => {
                    if let Some(entry) = state_clone.get(&sid) {
                        if let Ok(val) = serde_json::to_value(&m) {
                            entry.buffer.lock().await.push(val);
                        }
                    }
                }
                Some(Err(_)) | None => {
                    if let Some(entry) = state_clone.get(&sid) {
                        *entry.finished.lock().await = true;
                    }
                    break;
                }
            }
        }
    });

    state.insert(session_id, buffered);
    Ok(())
}

/// Poll the next message from an agent session.
///
/// Returns `null` when the session has ended and all buffered messages have been consumed.
#[tauri::command]
pub async fn agent_next_message(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let entry = state.get(&session_id).ok_or("Session not found")?;

    // Check buffer first
    {
        let mut buf = entry.buffer.lock().await;
        if !buf.is_empty() {
            return Ok(Some(buf.remove(0)));
        }
    }

    // If finished and buffer empty, session is done
    if *entry.finished.lock().await {
        return Ok(None);
    }

    // Buffer is empty but session is still running — wait a bit and check again
    drop(entry);
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let entry = state.get(&session_id).ok_or("Session not found")?;
    let mut buf = entry.buffer.lock().await;
    if !buf.is_empty() {
        return Ok(Some(buf.remove(0)));
    }

    if *entry.finished.lock().await {
        return Ok(None);
    }

    // Still waiting — return empty (frontend will poll again)
    // Use a sentinel to indicate "still running, no message yet"
    Ok(Some(serde_json::json!({"type": "waiting"})))
}

/// Send a follow-up message to an active agent session.
#[tauri::command]
pub async fn agent_send_message(
    state: State<'_, AgentState>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    let entry = state.get(&session_id).ok_or("Session not found")?;
    entry.session.send(&message).await.map_err(|e| e.to_string())
}

/// Interrupt the current agent operation.
#[tauri::command]
pub async fn agent_interrupt(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    let entry = state.get(&session_id).ok_or("Session not found")?;
    entry.session.interrupt().await.map_err(|e| e.to_string())
}

/// Close an agent session and clean up resources.
#[tauri::command]
pub async fn agent_close_session(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    if let Some((_, entry)) = state.remove(&session_id) {
        entry.session.close().await;
    }
    Ok(())
}

/// Parse a permission mode string into the SDK enum.
fn parse_permission_mode(mode: Option<&str>) -> PermissionMode {
    match mode {
        Some("accept-edits") => PermissionMode::AcceptEdits,
        Some("default") => PermissionMode::Default,
        _ => PermissionMode::DontAsk,
    }
}

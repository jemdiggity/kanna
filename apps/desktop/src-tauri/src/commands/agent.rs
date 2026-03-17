use claude_agent_sdk::{PermissionMode, Session, SessionOptions};
use dashmap::DashMap;
use std::sync::Arc;
use tauri::State;

/// Shared state holding all active agent sessions, keyed by session ID.
pub type AgentState = Arc<DashMap<String, Session>>;

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

    let session = Session::start(builder.build())
        .await
        .map_err(|e| e.to_string())?;

    session.send(&prompt).await.map_err(|e| e.to_string())?;
    state.insert(session_id, session);
    Ok(())
}

/// Poll the next message from an agent session.
///
/// Returns `null` when the session has ended (stdout closed).
#[tauri::command]
pub async fn agent_next_message(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let session = state.get(&session_id).ok_or("Session not found")?;
    match session.next_message().await {
        Some(Ok(msg)) => Ok(Some(serde_json::to_value(&msg).map_err(|e| e.to_string())?)),
        Some(Err(e)) => Err(e.to_string()),
        None => Ok(None),
    }
}

/// Send a follow-up message to an active agent session.
#[tauri::command]
pub async fn agent_send_message(
    state: State<'_, AgentState>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    let session = state.get(&session_id).ok_or("Session not found")?;
    session.send(&message).await.map_err(|e| e.to_string())
}

/// Interrupt the current agent operation.
#[tauri::command]
pub async fn agent_interrupt(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    let session = state.get(&session_id).ok_or("Session not found")?;
    session.interrupt().await.map_err(|e| e.to_string())
}

/// Close an agent session and clean up resources.
#[tauri::command]
pub async fn agent_close_session(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    if let Some((_, session)) = state.remove(&session_id) {
        session.close().await;
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

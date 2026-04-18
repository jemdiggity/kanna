use serde_json::Value;

async fn ensure_client(
    app: &tauri::AppHandle,
    guard: &mut Option<crate::transfer_sidecar::TransferSidecarClient>,
) -> Result<(), String> {
    if guard.is_none() {
        *guard = Some(crate::transfer_sidecar::TransferSidecarClient::spawn(
            app.clone(),
        )?);
    }
    Ok(())
}

#[tauri::command]
pub async fn list_transfer_peers(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferServiceState>,
) -> Result<Vec<Value>, String> {
    let mut guard = state.lock().await;
    ensure_client(&app, &mut guard).await?;
    let (result, dead) = {
        let client = guard
            .as_mut()
            .ok_or_else(|| "transfer sidecar client unavailable".to_string())?;
        let result = client.list_transfer_peers().await;
        (result, client.is_dead())
    };
    if dead {
        *guard = None;
    }
    result
}

#[tauri::command]
pub async fn start_peer_pairing(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferServiceState>,
    peer_id: String,
) -> Result<Value, String> {
    let mut guard = state.lock().await;
    ensure_client(&app, &mut guard).await?;
    let (result, dead) = {
        let client = guard
            .as_mut()
            .ok_or_else(|| "transfer sidecar client unavailable".to_string())?;
        let result = client.start_peer_pairing(peer_id).await;
        (result, client.is_dead())
    };
    if dead {
        *guard = None;
    }
    result
}

#[tauri::command]
pub async fn prepare_outgoing_transfer(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferServiceState>,
    payload: Value,
) -> Result<Value, String> {
    let mut guard = state.lock().await;
    ensure_client(&app, &mut guard).await?;
    let (result, dead) = {
        let client = guard
            .as_mut()
            .ok_or_else(|| "transfer sidecar client unavailable".to_string())?;
        let result = client.prepare_outgoing_transfer(payload).await;
        (result, client.is_dead())
    };
    if dead {
        *guard = None;
    }
    result
}

#[tauri::command]
pub async fn stage_transfer_artifact(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferServiceState>,
    transfer_id: String,
    artifact_id: String,
    path: String,
) -> Result<Value, String> {
    let mut guard = state.lock().await;
    ensure_client(&app, &mut guard).await?;
    let (result, dead) = {
        let client = guard
            .as_mut()
            .ok_or_else(|| "transfer sidecar client unavailable".to_string())?;
        let result = client
            .stage_transfer_artifact(transfer_id, artifact_id, path)
            .await;
        (result, client.is_dead())
    };
    if dead {
        *guard = None;
    }
    result
}

#[tauri::command]
pub async fn fetch_transfer_artifact(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferServiceState>,
    transfer_id: String,
    artifact_id: String,
) -> Result<Value, String> {
    let mut guard = state.lock().await;
    ensure_client(&app, &mut guard).await?;
    let (result, dead) = {
        let client = guard
            .as_mut()
            .ok_or_else(|| "transfer sidecar client unavailable".to_string())?;
        let result = client
            .fetch_transfer_artifact(transfer_id, artifact_id)
            .await;
        (result, client.is_dead())
    };
    if dead {
        *guard = None;
    }
    result
}

#[tauri::command]
pub async fn acknowledge_incoming_transfer_commit(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferServiceState>,
    transfer_id: String,
    source_task_id: String,
    destination_local_task_id: String,
) -> Result<Value, String> {
    let mut guard = state.lock().await;
    ensure_client(&app, &mut guard).await?;
    let (result, dead) = {
        let client = guard
            .as_mut()
            .ok_or_else(|| "transfer sidecar client unavailable".to_string())?;
        let result = client
            .acknowledge_incoming_transfer_commit(
                transfer_id,
                source_task_id,
                destination_local_task_id,
            )
            .await;
        (result, client.is_dead())
    };
    if dead {
        *guard = None;
    }
    result
}

#[tauri::command]
pub async fn finalize_outgoing_transfer(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferServiceState>,
    transfer_id: String,
) -> Result<Value, String> {
    let mut guard = state.lock().await;
    ensure_client(&app, &mut guard).await?;
    let (result, dead) = {
        let client = guard
            .as_mut()
            .ok_or_else(|| "transfer sidecar client unavailable".to_string())?;
        let result = client.finalize_outgoing_transfer(transfer_id).await;
        (result, client.is_dead())
    };
    if dead {
        *guard = None;
    }
    result
}

#[tauri::command]
pub async fn complete_outgoing_transfer_finalization(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::TransferServiceState>,
    transfer_id: String,
    payload: Option<Value>,
    finalized_cleanly: bool,
    error: Option<String>,
) -> Result<Value, String> {
    let mut guard = state.lock().await;
    ensure_client(&app, &mut guard).await?;
    let (result, dead) = {
        let client = guard
            .as_mut()
            .ok_or_else(|| "transfer sidecar client unavailable".to_string())?;
        let result = client
            .complete_outgoing_transfer_finalization(transfer_id, payload, finalized_cleanly, error)
            .await;
        (result, client.is_dead())
    };
    if dead {
        *guard = None;
    }
    result
}

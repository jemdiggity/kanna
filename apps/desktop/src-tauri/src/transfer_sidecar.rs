use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex};

type PendingRequests = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

pub struct TransferSidecarClient {
    _child: Child,
    stdin: ChildStdin,
    pending: PendingRequests,
    dead: Arc<AtomicBool>,
    request_counter: AtomicU64,
}

impl TransferSidecarClient {
    pub fn spawn(app: AppHandle) -> Result<Self, String> {
        let sidecar_path = resolve_sidecar_binary()?;
        let mut child = Command::new(&sidecar_path)
            .env(
                "KANNA_TRANSFER_PORT",
                std::env::var("KANNA_TRANSFER_PORT").unwrap_or_else(|_| "4455".to_string()),
            )
            .env(
                "KANNA_TRANSFER_REGISTRY_DIR",
                std::env::var("KANNA_TRANSFER_REGISTRY_DIR").unwrap_or_default(),
            )
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| format!("failed to spawn transfer sidecar: {}", e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "transfer sidecar stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "transfer sidecar stdout unavailable".to_string())?;
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let dead = Arc::new(AtomicBool::new(false));
        spawn_reader(app, stdout, Arc::clone(&pending), Arc::clone(&dead));

        Ok(Self {
            _child: child,
            stdin,
            pending,
            dead,
            request_counter: AtomicU64::new(1),
        })
    }

    pub fn is_dead(&self) -> bool {
        self.dead.load(Ordering::Relaxed)
    }

    pub async fn list_transfer_peers(&mut self) -> Result<Vec<Value>, String> {
        let request_id = self.next_request_id("list");
        let response = self
            .send_request(
                json!({
                    "type": "list_peers",
                    "request_id": request_id,
                }),
                &request_id,
            )
            .await?;
        let peers = response
            .get("peers")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| "transfer sidecar list_peers response missing peers".to_string())?;
        Ok(peers)
    }

    pub async fn start_peer_pairing(&mut self, peer_id: String) -> Result<Value, String> {
        let request_id = self.next_request_id("pair");
        let response = self
            .send_request(
                json!({
                    "type": "start_pairing",
                    "request_id": request_id,
                    "target_peer_id": peer_id,
                }),
                &request_id,
            )
            .await?;

        Ok(json!({
            "peer": response
                .get("peer")
                .cloned()
                .ok_or_else(|| "transfer sidecar start_pairing response missing peer".to_string())?,
            "verificationCode": required_string(
                &response,
                &["verification_code", "verificationCode"],
            )?,
        }))
    }

    pub async fn prepare_outgoing_transfer(&mut self, payload: Value) -> Result<Value, String> {
        let phase = payload
            .get("phase")
            .and_then(Value::as_str)
            .ok_or_else(|| "prepare_outgoing_transfer payload missing phase".to_string())?;

        match phase {
            "preflight" => self.prepare_transfer_preflight(payload).await,
            "commit" => self.prepare_transfer_commit(payload).await,
            other => Err(format!(
                "prepare_outgoing_transfer payload has unsupported phase {}",
                other
            )),
        }
    }

    pub async fn stage_transfer_artifact(
        &mut self,
        transfer_id: String,
        artifact_id: String,
        path: String,
    ) -> Result<Value, String> {
        let request_id = self.next_request_id("stage-artifact");
        let response = self
            .send_request(
                json!({
                    "type": "stage_transfer_artifact",
                    "request_id": request_id,
                    "transfer_id": transfer_id,
                    "artifact_id": artifact_id,
                    "path": path,
                }),
                &request_id,
            )
            .await?;

        Ok(json!({
            "transferId": required_string(&response, &["transfer_id", "transferId"])?,
            "artifactId": required_string(&response, &["artifact_id", "artifactId"])?,
        }))
    }

    pub async fn fetch_transfer_artifact(
        &mut self,
        transfer_id: String,
        artifact_id: String,
    ) -> Result<Value, String> {
        let request_id = self.next_request_id("fetch-artifact");
        let response = self
            .send_request(
                json!({
                    "type": "fetch_transfer_artifact",
                    "request_id": request_id,
                    "transfer_id": transfer_id,
                    "artifact_id": artifact_id,
                }),
                &request_id,
            )
            .await?;

        Ok(json!({
            "transferId": required_string(&response, &["transfer_id", "transferId"])?,
            "artifactId": required_string(&response, &["artifact_id", "artifactId"])?,
            "path": required_string(&response, &["path"])?,
        }))
    }

    pub async fn acknowledge_incoming_transfer_commit(
        &mut self,
        transfer_id: String,
        source_task_id: String,
        destination_local_task_id: String,
    ) -> Result<Value, String> {
        let request_id = self.next_request_id("commit-ack");
        let response = self
            .send_request(
                json!({
                    "type": "acknowledge_import_committed",
                    "request_id": request_id,
                    "transfer_id": transfer_id,
                    "source_task_id": source_task_id,
                    "destination_local_task_id": destination_local_task_id,
                }),
                &request_id,
            )
            .await?;

        Ok(json!({
            "transferId": required_string(&response, &["transfer_id", "transferId"])?,
        }))
    }

    async fn prepare_transfer_preflight(&mut self, payload: Value) -> Result<Value, String> {
        let source_task_id = required_string(&payload, &["sourceTaskId", "source_task_id"])?;
        let target_peer_id = required_string(&payload, &["targetPeerId", "target_peer_id"])?;
        let request_id = self.next_request_id("preflight");
        let response = self
            .send_request(
                json!({
                    "type": "prepare_transfer_preflight",
                    "request_id": request_id,
                    "source_task_id": source_task_id,
                    "target_peer_id": target_peer_id,
                }),
                &request_id,
            )
            .await?;

        Ok(json!({
            "transferId": required_string(&response, &["transfer_id", "transferId"])?,
            "sourcePeerId": required_string(&response, &["source_peer_id", "sourcePeerId"])?,
            "targetHasRepo": required_bool(&response, &["target_has_repo", "targetHasRepo"])?,
        }))
    }

    async fn prepare_transfer_commit(&mut self, payload: Value) -> Result<Value, String> {
        let transfer_id = required_string(&payload, &["transferId", "transfer_id"])?;
        let transfer_payload = payload.get("payload").cloned().ok_or_else(|| {
            "prepare_outgoing_transfer commit payload missing payload".to_string()
        })?;
        let request_id = self.next_request_id("commit");
        let response = self
            .send_request(
                json!({
                    "type": "prepare_transfer_commit",
                    "request_id": request_id,
                    "transfer_id": transfer_id,
                    "payload": transfer_payload,
                }),
                &request_id,
            )
            .await?;

        Ok(json!({
            "transferId": required_string(&response, &["transfer_id", "transferId"])?,
        }))
    }

    async fn send_request(&mut self, request: Value, request_id: &str) -> Result<Value, String> {
        if self.is_dead() {
            return Err("transfer sidecar client is not running".to_string());
        }

        let encoded = serde_json::to_vec(&request)
            .map_err(|e| format!("failed to encode transfer sidecar request: {}", e))?;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(request_id.to_string(), tx);

        if let Err(error) = self.stdin.write_all(&encoded).await {
            self.dead.store(true, Ordering::Relaxed);
            self.pending.lock().await.remove(request_id);
            return Err(format!(
                "failed to write transfer sidecar request {}: {}",
                request_id, error
            ));
        }
        if let Err(error) = self.stdin.write_all(b"\n").await {
            self.dead.store(true, Ordering::Relaxed);
            self.pending.lock().await.remove(request_id);
            return Err(format!(
                "failed to terminate transfer sidecar request {}: {}",
                request_id, error
            ));
        }
        if let Err(error) = self.stdin.flush().await {
            self.dead.store(true, Ordering::Relaxed);
            self.pending.lock().await.remove(request_id);
            return Err(format!(
                "failed to flush transfer sidecar request {}: {}",
                request_id, error
            ));
        }

        let response = rx.await.map_err(|_| {
            self.dead.store(true, Ordering::Relaxed);
            format!(
                "transfer sidecar response channel closed for {}",
                request_id
            )
        })?;
        if response.get("type").and_then(Value::as_str) == Some("error") {
            return Err(response
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| "transfer sidecar returned an unknown error".to_string()));
        }
        Ok(response)
    }

    fn next_request_id(&self, prefix: &str) -> String {
        format!(
            "{}-{}",
            prefix,
            self.request_counter.fetch_add(1, Ordering::Relaxed)
        )
    }
}

fn spawn_reader(
    app: AppHandle,
    stdout: ChildStdout,
    pending: PendingRequests,
    dead: Arc<AtomicBool>,
) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            let line = match lines.next_line().await {
                Ok(Some(line)) => line,
                Ok(None) => break,
                Err(error) => {
                    dead.store(true, Ordering::Relaxed);
                    eprintln!("[transfer-sidecar] failed reading stdout: {}", error);
                    break;
                }
            };

            if line.trim().is_empty() {
                continue;
            }

            let value = match serde_json::from_str::<Value>(&line) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("[transfer-sidecar] invalid JSON from sidecar: {}", error);
                    continue;
                }
            };

            if let Some(request_id) = value.get("request_id").and_then(Value::as_str) {
                if let Some(sender) = pending.lock().await.remove(request_id) {
                    let _ = sender.send(value);
                } else {
                    eprintln!(
                        "[transfer-sidecar] dropped response for unknown request {}",
                        request_id
                    );
                }
                continue;
            }

            if value.get("type").and_then(Value::as_str) == Some("incoming_transfer_request") {
                let _ = app.emit("transfer-request", &value);
                continue;
            }

            if value.get("type").and_then(Value::as_str) == Some("pairing_completed") {
                let _ = app.emit("pairing-completed", &value);
                continue;
            }

            if value.get("type").and_then(Value::as_str) == Some("outgoing_transfer_committed") {
                let _ = app.emit("outgoing-transfer-committed", &value);
                continue;
            }

            eprintln!("[transfer-sidecar] unhandled sidecar message: {}", value);
        }

        dead.store(true, Ordering::Relaxed);
        pending.lock().await.clear();
    });
}

fn required_string(value: &Value, keys: &[&str]) -> Result<String, String> {
    for key in keys {
        if let Some(result) = value.get(key).and_then(Value::as_str) {
            if !result.is_empty() {
                return Ok(result.to_string());
            }
        }
    }
    Err(format!(
        "missing required string field {}",
        keys.join(" or ")
    ))
}

fn required_bool(value: &Value, keys: &[&str]) -> Result<bool, String> {
    for key in keys {
        if let Some(result) = value.get(key).and_then(Value::as_bool) {
            return Ok(result);
        }
    }
    Err(format!(
        "missing required boolean field {}",
        keys.join(" or ")
    ))
}

fn resolve_sidecar_binary() -> Result<PathBuf, String> {
    let sidecar_name = format!(
        "kanna-task-transfer-{}",
        crate::commands::fs::current_target_triple()
    );
    let candidates = [
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join(&sidecar_name))),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("kanna-task-transfer"))),
        std::env::current_exe().ok().and_then(|p| {
            p.parent()
                .map(|d| d.join("../Resources").join("kanna-task-transfer"))
        }),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("kanna-task-transfer sidecar binary not found".to_string())
}

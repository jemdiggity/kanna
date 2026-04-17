use crate::discovery::encode_txt_record;
use crate::protocol::{PeerRegistryEntry, PeerRequest, PeerResponse};
use crate::registry::{PeerRegistry, RegistryError};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfig {
    pub peer_id: String,
    pub display_name: String,
    pub registry_dir: PathBuf,
    pub listen_port: u16,
    pending_transfer_ttl: Duration,
}

impl RuntimeConfig {
    pub fn for_tests(
        peer_id: impl Into<String>,
        display_name: impl Into<String>,
        registry_dir: impl AsRef<Path>,
        listen_port: u16,
    ) -> Self {
        Self {
            peer_id: peer_id.into(),
            display_name: display_name.into(),
            registry_dir: registry_dir.as_ref().to_path_buf(),
            listen_port,
            pending_transfer_ttl: Duration::from_secs(300),
        }
    }

    pub fn with_pending_transfer_ttl(mut self, pending_transfer_ttl: Duration) -> Self {
        self.pending_transfer_ttl = pending_transfer_ttl;
        self
    }

    pub fn from_env() -> Result<Self, RuntimeError> {
        let listen_port = std::env::var("KANNA_TRANSFER_PORT")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|error| RuntimeError::InvalidConfig(error.to_string()))?
            .unwrap_or(4455);

        let registry_dir = std::env::var("KANNA_TRANSFER_REGISTRY_DIR")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or(std::env::current_dir()?.join(".kanna-transfer-registry"));

        let peer_id = std::env::var("KANNA_TRANSFER_PEER_ID")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("peer-{}-{}", process::id(), listen_port));

        let display_name = std::env::var("KANNA_TRANSFER_DISPLAY_NAME")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("Kanna {}", process::id()));

        Ok(Self {
            peer_id,
            display_name,
            registry_dir,
            listen_port,
            pending_transfer_ttl: Duration::from_secs(300),
        })
    }

    fn endpoint(&self) -> String {
        format!("127.0.0.1:{}", self.listen_port)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreflightResult {
    pub transfer_id: String,
    pub source_peer_id: String,
    pub target_has_repo: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomingTransferEvent {
    pub transfer_id: String,
    pub source_peer_id: String,
    pub source_task_id: String,
    pub source_name: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingTransferCommittedEvent {
    pub transfer_id: String,
    pub source_task_id: String,
    pub destination_local_task_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeEvent {
    IncomingTransferRequest(IncomingTransferEvent),
    OutgoingTransferCommitted(OutgoingTransferCommittedEvent),
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("registry error: {0}")]
    Registry(#[from] RegistryError),
    #[error("invalid runtime config: {0}")]
    InvalidConfig(String),
    #[error("peer not found: {0}")]
    PeerNotFound(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("incoming event channel closed")]
    IncomingEventChannelClosed,
}

#[derive(Debug, Clone)]
struct IncomingTransferReservation {
    source_peer_id: String,
    source_task_id: String,
    created_at: Instant,
}

#[derive(Debug, Clone)]
struct OutgoingTransferReservation {
    target_peer_id: String,
    created_at: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedTransferArtifact {
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
struct TransferArtifactRecord {
    path: PathBuf,
    created_at: Instant,
}

#[derive(Clone)]
struct ListenerContext {
    self_peer_id: String,
    registry_root: PathBuf,
    pending_transfer_ttl: Duration,
    incoming_reservations: Arc<Mutex<HashMap<String, IncomingTransferReservation>>>,
    transfer_artifacts: Arc<Mutex<HashMap<String, HashMap<String, TransferArtifactRecord>>>>,
    request_counter: Arc<AtomicU64>,
    incoming_sender: mpsc::UnboundedSender<RuntimeEvent>,
}

pub struct TransferRuntime {
    config: RuntimeConfig,
    registry: PeerRegistry,
    outgoing_transfers: Mutex<HashMap<String, OutgoingTransferReservation>>,
    incoming_reservations: Arc<Mutex<HashMap<String, IncomingTransferReservation>>>,
    transfer_artifacts: Arc<Mutex<HashMap<String, HashMap<String, TransferArtifactRecord>>>>,
    incoming_events: Mutex<mpsc::UnboundedReceiver<RuntimeEvent>>,
    request_counter: Arc<AtomicU64>,
    listener_task: JoinHandle<()>,
    registry_entry_path: PathBuf,
}

impl TransferRuntime {
    pub async fn spawn(mut config: RuntimeConfig) -> Result<Self, RuntimeError> {
        let _ = encode_txt_record(&config.peer_id, &config.display_name, 1, true)
            .map_err(|error| RuntimeError::InvalidConfig(error.to_string()))?;

        let listener = TcpListener::bind(("127.0.0.1", config.listen_port)).await?;
        config.listen_port = listener.local_addr()?.port();
        let registry = PeerRegistry::new(config.registry_dir.clone());
        let registry_entry = PeerRegistryEntry {
            peer_id: config.peer_id.clone(),
            display_name: config.display_name.clone(),
            endpoint: config.endpoint(),
            pid: process::id(),
        };
        registry.write_entry(&registry_entry)?;

        let registry_entry_path = registry_entry_path(&config.registry_dir, &config.peer_id);
        let (incoming_sender, incoming_receiver) = mpsc::unbounded_channel();
        let incoming_reservations = Arc::new(Mutex::new(HashMap::new()));
        let transfer_artifacts = Arc::new(Mutex::new(HashMap::new()));
        let request_counter = Arc::new(AtomicU64::new(1));
        let listener_context = ListenerContext {
            self_peer_id: config.peer_id.clone(),
            registry_root: config.registry_dir.clone(),
            pending_transfer_ttl: config.pending_transfer_ttl,
            incoming_reservations: Arc::clone(&incoming_reservations),
            transfer_artifacts: Arc::clone(&transfer_artifacts),
            request_counter: Arc::clone(&request_counter),
            incoming_sender,
        };
        let listener_task = tokio::spawn(run_listener(listener, listener_context));

        Ok(Self {
            config,
            registry,
            outgoing_transfers: Mutex::new(HashMap::new()),
            incoming_reservations,
            transfer_artifacts,
            incoming_events: Mutex::new(incoming_receiver),
            request_counter,
            listener_task,
            registry_entry_path,
        })
    }

    pub async fn list_peers(&self) -> Result<Vec<PeerRegistryEntry>, RuntimeError> {
        self.registry
            .list_peers(&self.config.peer_id)
            .map_err(RuntimeError::from)
    }

    pub async fn prepare_transfer_preflight(
        &self,
        target_peer_id: &str,
        source_task_id: &str,
    ) -> Result<PreflightResult, RuntimeError> {
        let target_peer = self.find_peer(target_peer_id).await?;
        let request_id = self.next_request_id("preflight");
        let response = self
            .send_peer_request(
                &target_peer,
                PeerRequest::PrepareTransfer {
                    request_id: request_id.clone(),
                    source_task_id: source_task_id.to_owned(),
                    source_peer_id: self.config.peer_id.clone(),
                },
            )
            .await?;

        match response {
            PeerResponse::PrepareTransfer {
                request_id: response_request_id,
                transfer_id,
                source_peer_id,
                target_has_repo,
            } => {
                if response_request_id != request_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched request id in preflight response: expected {}, got {}",
                        request_id, response_request_id
                    )));
                }

                let mut transfers = self.outgoing_transfers.lock().await;
                prune_outgoing_transfers(&mut transfers, self.config.pending_transfer_ttl);
                transfers.insert(
                    transfer_id.clone(),
                    OutgoingTransferReservation {
                        target_peer_id: target_peer_id.to_owned(),
                        created_at: Instant::now(),
                    },
                );

                Ok(PreflightResult {
                    transfer_id,
                    source_peer_id,
                    target_has_repo,
                })
            }
            PeerResponse::SubmitTransferPayload { .. } => Err(RuntimeError::Protocol(
                "unexpected submit-transfer response during preflight".into(),
            )),
            PeerResponse::FetchTransferArtifact { .. } => Err(RuntimeError::Protocol(
                "unexpected fetch-transfer-artifact response during preflight".into(),
            )),
            PeerResponse::ImportCommitted { .. } => Err(RuntimeError::Protocol(
                "unexpected import-committed response during preflight".into(),
            )),
            PeerResponse::Error {
                request_id: _,
                message,
            } => Err(RuntimeError::Protocol(message)),
        }
    }

    pub async fn prepare_transfer_commit(
        &self,
        transfer_id: &str,
        payload: Value,
    ) -> Result<(), RuntimeError> {
        let target_peer_id = {
            let mut transfers = self.outgoing_transfers.lock().await;
            prune_outgoing_transfers(&mut transfers, self.config.pending_transfer_ttl);
            transfers
                .get(transfer_id)
                .map(|reservation| reservation.target_peer_id.clone())
        }
        .ok_or_else(|| {
            RuntimeError::Protocol(format!(
                "missing target peer for transfer commit {}",
                transfer_id
            ))
        })?;

        let target_peer = self.find_peer(&target_peer_id).await?;
        let request_id = self.next_request_id("commit");
        let response = self
            .send_peer_request(
                &target_peer,
                PeerRequest::SubmitTransferPayload {
                    request_id: request_id.clone(),
                    transfer_id: transfer_id.to_owned(),
                    payload,
                },
            )
            .await?;

        match response {
            PeerResponse::SubmitTransferPayload {
                request_id: response_request_id,
                transfer_id: response_transfer_id,
            } => {
                if response_request_id != request_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched request id in commit response: expected {}, got {}",
                        request_id, response_request_id
                    )));
                }

                if response_transfer_id != transfer_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched transfer id in commit response: expected {}, got {}",
                        transfer_id, response_transfer_id
                    )));
                }

                self.outgoing_transfers.lock().await.remove(transfer_id);
                Ok(())
            }
            PeerResponse::PrepareTransfer { .. } => Err(RuntimeError::Protocol(
                "unexpected preflight response during transfer commit".into(),
            )),
            PeerResponse::FetchTransferArtifact { .. } => Err(RuntimeError::Protocol(
                "unexpected fetch-transfer-artifact response during transfer commit".into(),
            )),
            PeerResponse::ImportCommitted { .. } => Err(RuntimeError::Protocol(
                "unexpected import-committed response during transfer commit".into(),
            )),
            PeerResponse::Error {
                request_id: _,
                message,
            } => Err(RuntimeError::Protocol(message)),
        }
    }

    pub async fn next_event(&self) -> Result<RuntimeEvent, RuntimeError> {
        let mut receiver = self.incoming_events.lock().await;
        receiver
            .recv()
            .await
            .ok_or(RuntimeError::IncomingEventChannelClosed)
    }

    pub async fn stage_transfer_artifact(
        &self,
        transfer_id: &str,
        artifact_id: &str,
        path: PathBuf,
    ) -> Result<(), RuntimeError> {
        let mut transfer_artifacts = self.transfer_artifacts.lock().await;
        prune_transfer_artifacts(&mut transfer_artifacts, self.config.pending_transfer_ttl);
        transfer_artifacts
            .entry(transfer_id.to_owned())
            .or_default()
            .insert(
                artifact_id.to_owned(),
                TransferArtifactRecord {
                    path,
                    created_at: Instant::now(),
                },
            );
        Ok(())
    }

    pub async fn fetch_transfer_artifact(
        &self,
        transfer_id: &str,
        artifact_id: &str,
    ) -> Result<StagedTransferArtifact, RuntimeError> {
        if let Some(path) = self
            .lookup_transfer_artifact(transfer_id, artifact_id)
            .await
        {
            return Ok(StagedTransferArtifact { path });
        }

        let source_peer_id = {
            let mut reservations = self.incoming_reservations.lock().await;
            prune_incoming_reservations(&mut reservations, self.config.pending_transfer_ttl);
            reservations
                .get(transfer_id)
                .map(|reservation| reservation.source_peer_id.clone())
        }
        .ok_or_else(|| {
            RuntimeError::Protocol(format!(
                "missing source peer for transfer artifact {} on transfer {}",
                artifact_id, transfer_id
            ))
        })?;

        let source_peer = self.find_peer(&source_peer_id).await?;
        let request_id = self.next_request_id("fetch-artifact");
        let response = self
            .send_peer_request(
                &source_peer,
                PeerRequest::FetchTransferArtifact {
                    request_id: request_id.clone(),
                    transfer_id: transfer_id.to_owned(),
                    artifact_id: artifact_id.to_owned(),
                },
            )
            .await?;

        match response {
            PeerResponse::FetchTransferArtifact {
                request_id: response_request_id,
                transfer_id: response_transfer_id,
                artifact_id: response_artifact_id,
                filename,
                payload_b64,
            } => {
                if response_request_id != request_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched request id in artifact fetch response: expected {}, got {}",
                        request_id, response_request_id
                    )));
                }
                if response_transfer_id != transfer_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched transfer id in artifact fetch response: expected {}, got {}",
                        transfer_id, response_transfer_id
                    )));
                }
                if response_artifact_id != artifact_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched artifact id in artifact fetch response: expected {}, got {}",
                        artifact_id, response_artifact_id
                    )));
                }

                let path = self
                    .materialize_transfer_artifact(
                        transfer_id,
                        artifact_id,
                        &filename,
                        &payload_b64,
                    )
                    .await?;
                Ok(StagedTransferArtifact { path })
            }
            PeerResponse::PrepareTransfer { .. }
            | PeerResponse::SubmitTransferPayload { .. }
            | PeerResponse::ImportCommitted { .. } => Err(RuntimeError::Protocol(
                "unexpected response while fetching transfer artifact".into(),
            )),
            PeerResponse::Error {
                request_id: _,
                message,
            } => Err(RuntimeError::Protocol(message)),
        }
    }

    pub async fn acknowledge_import_committed(
        &self,
        transfer_id: &str,
        source_task_id: &str,
        destination_local_task_id: &str,
    ) -> Result<(), RuntimeError> {
        let source_peer_id = {
            let mut reservations = self.incoming_reservations.lock().await;
            prune_incoming_reservations(&mut reservations, self.config.pending_transfer_ttl);
            reservations
                .get(transfer_id)
                .map(|reservation| reservation.source_peer_id.clone())
        }
        .ok_or_else(|| {
            RuntimeError::Protocol(format!(
                "missing source peer for import acknowledgment {}",
                transfer_id
            ))
        })?;

        let source_peer = self.find_peer(&source_peer_id).await?;
        let request_id = self.next_request_id("import-committed");
        let response = self
            .send_peer_request(
                &source_peer,
                PeerRequest::ImportCommitted {
                    request_id: request_id.clone(),
                    transfer_id: transfer_id.to_owned(),
                    source_task_id: source_task_id.to_owned(),
                    destination_local_task_id: destination_local_task_id.to_owned(),
                },
            )
            .await?;

        match response {
            PeerResponse::ImportCommitted {
                request_id: response_request_id,
                transfer_id: response_transfer_id,
            } => {
                if response_request_id != request_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched request id in import commit acknowledgment: expected {}, got {}",
                        request_id, response_request_id
                    )));
                }

                if response_transfer_id != transfer_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched transfer id in import commit acknowledgment: expected {}, got {}",
                        transfer_id, response_transfer_id
                    )));
                }

                self.incoming_reservations.lock().await.remove(transfer_id);
                Ok(())
            }
            PeerResponse::PrepareTransfer { .. }
            | PeerResponse::SubmitTransferPayload { .. }
            | PeerResponse::FetchTransferArtifact { .. } => Err(RuntimeError::Protocol(
                "unexpected response while acknowledging import commit".into(),
            )),
            PeerResponse::Error {
                request_id: _,
                message,
            } => Err(RuntimeError::Protocol(message)),
        }
    }

    async fn find_peer(&self, target_peer_id: &str) -> Result<PeerRegistryEntry, RuntimeError> {
        let peers = self.list_peers().await?;
        peers
            .into_iter()
            .find(|peer| peer.peer_id == target_peer_id)
            .ok_or_else(|| RuntimeError::PeerNotFound(target_peer_id.to_owned()))
    }

    async fn send_peer_request(
        &self,
        peer: &PeerRegistryEntry,
        request: PeerRequest,
    ) -> Result<PeerResponse, RuntimeError> {
        let mut stream = TcpStream::connect(&peer.endpoint).await?;
        write_json_line(&mut stream, &request).await?;

        let mut response_line = String::new();
        let mut reader = BufReader::new(stream);
        let read = reader.read_line(&mut response_line).await?;
        if read == 0 {
            return Err(RuntimeError::Protocol(format!(
                "peer {} closed the connection without a response",
                peer.peer_id
            )));
        }

        let response = serde_json::from_str::<PeerResponse>(response_line.trim())?;
        Ok(response)
    }

    fn next_request_id(&self, prefix: &str) -> String {
        format!(
            "{}-{}-{}",
            prefix,
            self.config.peer_id,
            self.request_counter.fetch_add(1, Ordering::Relaxed)
        )
    }

    async fn lookup_transfer_artifact(
        &self,
        transfer_id: &str,
        artifact_id: &str,
    ) -> Option<PathBuf> {
        let mut transfer_artifacts = self.transfer_artifacts.lock().await;
        prune_transfer_artifacts(&mut transfer_artifacts, self.config.pending_transfer_ttl);
        transfer_artifacts
            .get(transfer_id)
            .and_then(|artifacts| artifacts.get(artifact_id))
            .map(|artifact| artifact.path.clone())
    }

    async fn materialize_transfer_artifact(
        &self,
        transfer_id: &str,
        artifact_id: &str,
        filename: &str,
        payload_b64: &str,
    ) -> Result<PathBuf, RuntimeError> {
        let artifact_dir = self.config.registry_dir.join("artifacts").join(transfer_id);
        std::fs::create_dir_all(&artifact_dir)?;

        let destination_path = artifact_dir.join(format!(
            "{}-{}",
            artifact_id,
            sanitize_artifact_filename(filename)
        ));
        let payload = URL_SAFE_NO_PAD.decode(payload_b64).map_err(|error| {
            RuntimeError::Protocol(format!("invalid artifact payload: {}", error))
        })?;
        std::fs::write(&destination_path, payload)?;

        let mut transfer_artifacts = self.transfer_artifacts.lock().await;
        prune_transfer_artifacts(&mut transfer_artifacts, self.config.pending_transfer_ttl);
        transfer_artifacts
            .entry(transfer_id.to_owned())
            .or_default()
            .insert(
                artifact_id.to_owned(),
                TransferArtifactRecord {
                    path: destination_path.clone(),
                    created_at: Instant::now(),
                },
            );

        Ok(destination_path)
    }
}

impl Drop for TransferRuntime {
    fn drop(&mut self) {
        self.listener_task.abort();
        let _ = std::fs::remove_file(&self.registry_entry_path);
        if let Ok(mut reservations) = self.incoming_reservations.try_lock() {
            reservations.clear();
        }
        if let Ok(mut transfer_artifacts) = self.transfer_artifacts.try_lock() {
            transfer_artifacts.clear();
        }
    }
}

async fn run_listener(listener: TcpListener, context: ListenerContext) {
    loop {
        let accepted = listener.accept().await;
        let (stream, _) = match accepted {
            Ok(accepted) => accepted,
            Err(_) => break,
        };

        let connection_context = context.clone();

        tokio::spawn(async move {
            let _ = handle_connection(stream, connection_context).await;
        });
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    context: ListenerContext,
) -> Result<(), RuntimeError> {
    let mut line = String::new();
    let read = {
        let mut reader = BufReader::new(&mut stream);
        reader.read_line(&mut line).await?
    };

    if read == 0 {
        return Ok(());
    }

    let request_id = extract_request_id(&line);
    let response = match serde_json::from_str::<PeerRequest>(line.trim()) {
        Ok(PeerRequest::PrepareTransfer {
            request_id,
            source_task_id,
            source_peer_id,
        }) => {
            let mut reservations = context.incoming_reservations.lock().await;
            prune_incoming_reservations(&mut reservations, context.pending_transfer_ttl);
            let transfer_id = format!(
                "{}-transfer-{}",
                context.self_peer_id,
                context.request_counter.fetch_add(1, Ordering::Relaxed)
            );
            reservations.insert(
                transfer_id.clone(),
                IncomingTransferReservation {
                    source_peer_id: source_peer_id.clone(),
                    source_task_id,
                    created_at: Instant::now(),
                },
            );

            PeerResponse::PrepareTransfer {
                request_id,
                transfer_id,
                source_peer_id,
                target_has_repo: false,
            }
        }
        Ok(PeerRequest::SubmitTransferPayload {
            request_id,
            transfer_id,
            payload,
        }) => {
            match build_incoming_event(
                &context.self_peer_id,
                &context.registry_root,
                &transfer_id,
                context.pending_transfer_ttl,
                payload,
                &context.incoming_reservations,
            )
            .await
            {
                Ok(event) => {
                    context
                        .incoming_sender
                        .send(RuntimeEvent::IncomingTransferRequest(event))
                        .map_err(|_| RuntimeError::IncomingEventChannelClosed)?;
                    PeerResponse::SubmitTransferPayload {
                        request_id,
                        transfer_id,
                    }
                }
                Err(error) => PeerResponse::Error {
                    request_id,
                    message: error.to_string(),
                },
            }
        }
        Ok(PeerRequest::FetchTransferArtifact {
            request_id,
            transfer_id,
            artifact_id,
        }) => {
            let mut artifacts = context.transfer_artifacts.lock().await;
            prune_transfer_artifacts(&mut artifacts, context.pending_transfer_ttl);
            match artifacts
                .get(&transfer_id)
                .and_then(|artifacts| artifacts.get(&artifact_id))
                .cloned()
            {
                Some(artifact) => {
                    let filename = artifact
                        .path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("artifact")
                        .to_string();
                    let payload_b64 = URL_SAFE_NO_PAD.encode(std::fs::read(&artifact.path)?);
                    PeerResponse::FetchTransferArtifact {
                        request_id,
                        transfer_id,
                        artifact_id,
                        filename,
                        payload_b64,
                    }
                }
                None => PeerResponse::Error {
                    request_id,
                    message: format!(
                        "missing transfer artifact {} for transfer {}",
                        artifact_id, transfer_id
                    ),
                },
            }
        }
        Ok(PeerRequest::ImportCommitted {
            request_id,
            transfer_id,
            source_task_id,
            destination_local_task_id,
        }) => {
            context
                .incoming_sender
                .send(RuntimeEvent::OutgoingTransferCommitted(
                    OutgoingTransferCommittedEvent {
                        transfer_id: transfer_id.clone(),
                        source_task_id,
                        destination_local_task_id,
                    },
                ))
                .map_err(|_| RuntimeError::IncomingEventChannelClosed)?;
            PeerResponse::ImportCommitted {
                request_id,
                transfer_id,
            }
        }
        Err(error) => PeerResponse::Error {
            request_id,
            message: error.to_string(),
        },
    };

    write_json_line(&mut stream, &response).await?;
    Ok(())
}

async fn build_incoming_event(
    self_peer_id: &str,
    registry_root: &Path,
    transfer_id: &str,
    pending_transfer_ttl: Duration,
    payload: Value,
    incoming_reservations: &Arc<Mutex<HashMap<String, IncomingTransferReservation>>>,
) -> Result<IncomingTransferEvent, RuntimeError> {
    let reservation = {
        let mut reservations = incoming_reservations.lock().await;
        prune_incoming_reservations(&mut reservations, pending_transfer_ttl);
        reservations
            .get(transfer_id)
            .cloned()
            .ok_or_else(|| RuntimeError::Protocol(format!("unknown transfer id {}", transfer_id)))?
    };

    let source_task_id = payload
        .pointer("/task/source_task_id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or(reservation.source_task_id);

    let source_name = PeerRegistry::new(registry_root.to_path_buf())
        .list_peers(self_peer_id)?
        .into_iter()
        .find(|peer| peer.peer_id == reservation.source_peer_id)
        .map(|peer| peer.display_name);

    Ok(IncomingTransferEvent {
        transfer_id: transfer_id.to_owned(),
        source_peer_id: reservation.source_peer_id,
        source_task_id,
        source_name,
        payload,
    })
}

fn extract_request_id(line: &str) -> String {
    serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|value| {
            value
                .get("request_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_default()
}

async fn write_json_line<T>(stream: &mut TcpStream, value: &T) -> Result<(), RuntimeError>
where
    T: serde::Serialize,
{
    let encoded = serde_json::to_vec(value)?;
    stream.write_all(&encoded).await?;
    stream.write_all(b"\n").await?;
    stream.flush().await?;
    Ok(())
}

fn registry_entry_path(root: &Path, peer_id: &str) -> PathBuf {
    root.join(format!("{}.json", URL_SAFE_NO_PAD.encode(peer_id)))
}

fn prune_outgoing_transfers(
    transfers: &mut HashMap<String, OutgoingTransferReservation>,
    pending_transfer_ttl: Duration,
) {
    let now = Instant::now();
    transfers
        .retain(|_, reservation| now.duration_since(reservation.created_at) < pending_transfer_ttl);
}

fn prune_incoming_reservations(
    reservations: &mut HashMap<String, IncomingTransferReservation>,
    pending_transfer_ttl: Duration,
) {
    let now = Instant::now();
    reservations
        .retain(|_, reservation| now.duration_since(reservation.created_at) < pending_transfer_ttl);
}

fn prune_transfer_artifacts(
    transfer_artifacts: &mut HashMap<String, HashMap<String, TransferArtifactRecord>>,
    pending_transfer_ttl: Duration,
) {
    let now = Instant::now();
    transfer_artifacts.retain(|_, artifacts| {
        artifacts
            .retain(|_, artifact| now.duration_since(artifact.created_at) < pending_transfer_ttl);
        !artifacts.is_empty()
    });
}

fn sanitize_artifact_filename(filename: &str) -> String {
    let sanitized = filename
        .chars()
        .map(|character| match character {
            '/' | '\\' => '-',
            _ => character,
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "artifact".to_string()
    } else {
        sanitized
    }
}

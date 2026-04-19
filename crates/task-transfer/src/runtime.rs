use crate::crypto::{
    open_json, parse_public_key, public_key_to_string, seal_json, CryptoError, TransferIdentity,
};
use crate::discovery::{
    encode_txt_record, hostname_for_peer, resolved_service_to_peer_entry, SERVICE_TYPE,
};
use crate::peer_store::{PeerRecord, PeerStore, PeerStoreError};
use crate::protocol::{DiscoveredPeer, PairingPeer, PeerRegistryEntry, PeerRequest, PeerResponse};
use crate::registry::{PeerRegistry, RegistryError};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::Utc;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryMode {
    Registry,
    Mdns,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfig {
    pub peer_id: String,
    pub display_name: String,
    pub registry_dir: PathBuf,
    pub listen_port: u16,
    discovery_mode: DiscoveryMode,
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
            discovery_mode: DiscoveryMode::Registry,
            pending_transfer_ttl: Duration::from_secs(300),
        }
    }

    pub fn with_discovery_mode(mut self, discovery_mode: DiscoveryMode) -> Self {
        self.discovery_mode = discovery_mode;
        self
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
        let discovery_mode = std::env::var("KANNA_TRANSFER_DISCOVERY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| match value.as_str() {
                "registry" => Ok(DiscoveryMode::Registry),
                "mdns" | "bonjour" => Ok(DiscoveryMode::Mdns),
                other => Err(RuntimeError::InvalidConfig(format!(
                    "unsupported transfer discovery mode: {other}"
                ))),
            })
            .transpose()?
            .unwrap_or(DiscoveryMode::Mdns);

        Ok(Self {
            peer_id,
            display_name,
            registry_dir,
            listen_port,
            discovery_mode,
            pending_transfer_ttl: Duration::from_secs(300),
        })
    }

    fn endpoint(&self) -> String {
        format!("127.0.0.1:{}", self.listen_port)
    }

    fn bind_host(&self) -> &'static str {
        match self.discovery_mode {
            DiscoveryMode::Registry => "127.0.0.1",
            DiscoveryMode::Mdns => "0.0.0.0",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreflightResult {
    pub transfer_id: String,
    pub source_peer_id: String,
    pub target_has_repo: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FinalizedOutgoingTransfer {
    pub payload: Value,
    pub finalized_cleanly: bool,
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
pub struct OutgoingTransferFinalizationRequestedEvent {
    pub transfer_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingCompletedEvent {
    pub peer_id: String,
    pub display_name: String,
    pub verification_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingResult {
    pub peer: DiscoveredPeer,
    pub verification_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeEvent {
    PairingCompleted(PairingCompletedEvent),
    IncomingTransferRequest(IncomingTransferEvent),
    OutgoingTransferCommitted(OutgoingTransferCommittedEvent),
    OutgoingTransferFinalizationRequested(OutgoingTransferFinalizationRequestedEvent),
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("registry error: {0}")]
    Registry(#[from] RegistryError),
    #[error("peer store error: {0}")]
    PeerStore(#[from] PeerStoreError),
    #[error("crypto error: {0}")]
    Crypto(#[from] CryptoError),
    #[error("invalid runtime config: {0}")]
    InvalidConfig(String),
    #[error("peer not found: {0}")]
    PeerNotFound(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("discovery error: {0}")]
    Discovery(String),
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

type PendingOutgoingTransferFinalizations =
    Arc<Mutex<HashMap<String, oneshot::Sender<Result<FinalizedOutgoingTransfer, RuntimeError>>>>>;

#[derive(Clone)]
struct ListenerContext {
    self_peer_id: String,
    self_display_name: String,
    self_public_key: String,
    registry_root: PathBuf,
    discovery: PeerDiscovery,
    pending_transfer_ttl: Duration,
    outgoing_transfers: Arc<Mutex<HashMap<String, OutgoingTransferReservation>>>,
    pending_outgoing_transfer_finalizations: PendingOutgoingTransferFinalizations,
    incoming_reservations: Arc<Mutex<HashMap<String, IncomingTransferReservation>>>,
    transfer_artifacts: Arc<Mutex<HashMap<String, HashMap<String, TransferArtifactRecord>>>>,
    request_counter: Arc<AtomicU64>,
    incoming_sender: mpsc::UnboundedSender<RuntimeEvent>,
}

pub struct TransferRuntime {
    config: RuntimeConfig,
    discovery: PeerDiscovery,
    identity: TransferIdentity,
    outgoing_transfers: Arc<Mutex<HashMap<String, OutgoingTransferReservation>>>,
    pending_outgoing_transfer_finalizations: PendingOutgoingTransferFinalizations,
    incoming_reservations: Arc<Mutex<HashMap<String, IncomingTransferReservation>>>,
    transfer_artifacts: Arc<Mutex<HashMap<String, HashMap<String, TransferArtifactRecord>>>>,
    incoming_events: Mutex<mpsc::UnboundedReceiver<RuntimeEvent>>,
    request_counter: Arc<AtomicU64>,
    listener_task: JoinHandle<()>,
    registry_entry_path: Option<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredIdentity {
    secret_key: String,
}

#[derive(Clone)]
enum PeerDiscovery {
    Registry(PeerRegistry),
    Mdns(Arc<MdnsDiscovery>),
}

#[derive(Default)]
struct MdnsState {
    peers_by_id: HashMap<String, PeerRegistryEntry>,
    peer_ids_by_fullname: HashMap<String, String>,
}

struct MdnsDiscovery {
    daemon: ServiceDaemon,
    state: Arc<Mutex<MdnsState>>,
    browse_task: JoinHandle<()>,
    service_fullname: String,
}

impl PeerDiscovery {
    async fn list_peers(&self, self_peer_id: &str) -> Result<Vec<PeerRegistryEntry>, RuntimeError> {
        match self {
            Self::Registry(registry) => Ok(registry.list_peers(self_peer_id)?),
            Self::Mdns(discovery) => discovery.list_peers(self_peer_id).await,
        }
    }

    fn shutdown(&self) {
        if let Self::Mdns(discovery) = self {
            discovery.shutdown();
        }
    }
}

impl MdnsDiscovery {
    async fn spawn(
        peer_id: &str,
        display_name: &str,
        public_key: &str,
        listen_port: u16,
    ) -> Result<Self, RuntimeError> {
        let daemon =
            ServiceDaemon::new().map_err(|error| RuntimeError::Discovery(error.to_string()))?;
        let txt = encode_txt_record(peer_id, display_name, public_key, 1, true)
            .map_err(|error| RuntimeError::InvalidConfig(error.to_string()))?;
        let properties = txt
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        let hostname = hostname_for_peer(peer_id)
            .map_err(|error| RuntimeError::InvalidConfig(error.to_string()))?;
        let service_info = ServiceInfo::new(
            SERVICE_TYPE,
            peer_id,
            &hostname,
            "",
            listen_port,
            &properties[..],
        )
        .map_err(|error| RuntimeError::Discovery(error.to_string()))?
        .enable_addr_auto();
        let service_fullname = service_info.get_fullname().to_string();
        daemon
            .register(service_info)
            .map_err(|error| RuntimeError::Discovery(error.to_string()))?;

        let receiver = daemon
            .browse(SERVICE_TYPE)
            .map_err(|error| RuntimeError::Discovery(error.to_string()))?;
        let state = Arc::new(Mutex::new(MdnsState::default()));
        let browse_state = Arc::clone(&state);
        let browse_task = tokio::spawn(async move {
            while let Ok(event) = receiver.recv_async().await {
                handle_mdns_event(&browse_state, event).await;
            }
        });

        Ok(Self {
            daemon,
            state,
            browse_task,
            service_fullname,
        })
    }

    async fn list_peers(&self, self_peer_id: &str) -> Result<Vec<PeerRegistryEntry>, RuntimeError> {
        let state = self.state.lock().await;
        let mut peers = state
            .peers_by_id
            .values()
            .filter(|peer| peer.peer_id != self_peer_id)
            .cloned()
            .collect::<Vec<_>>();
        peers.sort_by(|left, right| left.peer_id.cmp(&right.peer_id));
        Ok(peers)
    }

    fn shutdown(&self) {
        self.browse_task.abort();
        let _ = self.daemon.unregister(&self.service_fullname);
        let _ = self.daemon.shutdown();
    }
}

impl TransferRuntime {
    pub async fn spawn(mut config: RuntimeConfig) -> Result<Self, RuntimeError> {
        let listener = TcpListener::bind((config.bind_host(), config.listen_port)).await?;
        config.listen_port = listener.local_addr()?.port();
        let identity = load_or_create_identity(&config.registry_dir, &config.peer_id)?;
        let public_key = public_key_to_string(&identity.public_key);
        let _ = encode_txt_record(&config.peer_id, &config.display_name, &public_key, 1, true)
            .map_err(|error| RuntimeError::InvalidConfig(error.to_string()))?;

        let (discovery, registry_entry_path) = match config.discovery_mode {
            DiscoveryMode::Registry => {
                let registry = PeerRegistry::new(config.registry_dir.clone());
                let registry_entry = PeerRegistryEntry {
                    peer_id: config.peer_id.clone(),
                    display_name: config.display_name.clone(),
                    endpoint: config.endpoint(),
                    pid: process::id(),
                    public_key: public_key.clone(),
                    protocol_version: 1,
                    accepting_transfers: true,
                };
                registry.write_entry(&registry_entry)?;
                (
                    PeerDiscovery::Registry(registry),
                    Some(registry_entry_path(&config.registry_dir, &config.peer_id)),
                )
            }
            DiscoveryMode::Mdns => (
                PeerDiscovery::Mdns(Arc::new(
                    MdnsDiscovery::spawn(
                        &config.peer_id,
                        &config.display_name,
                        &public_key,
                        config.listen_port,
                    )
                    .await?,
                )),
                None,
            ),
        };
        let (incoming_sender, incoming_receiver) = mpsc::unbounded_channel();
        let outgoing_transfers = Arc::new(Mutex::new(HashMap::new()));
        let pending_outgoing_transfer_finalizations = Arc::new(Mutex::new(HashMap::new()));
        let incoming_reservations = Arc::new(Mutex::new(HashMap::new()));
        let transfer_artifacts = Arc::new(Mutex::new(HashMap::new()));
        let request_counter = Arc::new(AtomicU64::new(1));
        let listener_context = ListenerContext {
            self_peer_id: config.peer_id.clone(),
            self_display_name: config.display_name.clone(),
            self_public_key: public_key,
            registry_root: config.registry_dir.clone(),
            discovery: discovery.clone(),
            pending_transfer_ttl: config.pending_transfer_ttl,
            outgoing_transfers: Arc::clone(&outgoing_transfers),
            pending_outgoing_transfer_finalizations: Arc::clone(
                &pending_outgoing_transfer_finalizations,
            ),
            incoming_reservations: Arc::clone(&incoming_reservations),
            transfer_artifacts: Arc::clone(&transfer_artifacts),
            request_counter: Arc::clone(&request_counter),
            incoming_sender,
        };
        let listener_task = tokio::spawn(run_listener(listener, listener_context));

        Ok(Self {
            config,
            discovery,
            identity,
            outgoing_transfers,
            pending_outgoing_transfer_finalizations,
            incoming_reservations,
            transfer_artifacts,
            incoming_events: Mutex::new(incoming_receiver),
            request_counter,
            listener_task,
            registry_entry_path,
        })
    }

    pub async fn list_peers(&self) -> Result<Vec<DiscoveredPeer>, RuntimeError> {
        self.discovery
            .list_peers(&self.config.peer_id)
            .await?
            .into_iter()
            .map(|peer| self.discovered_peer(peer))
            .collect()
    }

    pub async fn start_pairing(&self, target_peer_id: &str) -> Result<PairingResult, RuntimeError> {
        let target_peer = self.find_peer(target_peer_id).await?;
        let request_id = self.next_request_id("pair");
        let response = self
            .send_peer_request(
                &target_peer,
                PeerRequest::StartPairing {
                    request_id: request_id.clone(),
                    source_peer_id: self.config.peer_id.clone(),
                    source_display_name: self.config.display_name.clone(),
                    source_public_key: public_key_to_string(&self.identity.public_key),
                    capabilities_json: local_capabilities_json(),
                },
            )
            .await?;

        match response {
            PeerResponse::StartPairing {
                request_id: response_request_id,
                peer,
                verification_code,
            } => {
                if response_request_id != request_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched request id in pairing response: expected {}, got {}",
                        request_id, response_request_id
                    )));
                }

                if peer.peer_id != target_peer.peer_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched peer id in pairing response: expected {}, got {}",
                        target_peer.peer_id, peer.peer_id
                    )));
                }

                self.upsert_trusted_peer(PeerRecord {
                    peer_id: peer.peer_id,
                    display_name: peer.display_name,
                    public_key: peer.public_key,
                    capabilities_json: peer.capabilities_json,
                    paired_at: Utc::now().to_rfc3339(),
                    last_seen_at: Some(Utc::now().to_rfc3339()),
                    revoked_at: None,
                })?;

                Ok(PairingResult {
                    peer: self.discovered_peer(target_peer)?,
                    verification_code,
                })
            }
            PeerResponse::Error {
                request_id: _,
                message,
            } => Err(RuntimeError::Protocol(message)),
            other => Err(unexpected_peer_response("pairing", &other)),
        }
    }

    pub async fn prepare_transfer_preflight(
        &self,
        target_peer_id: &str,
        source_task_id: &str,
    ) -> Result<PreflightResult, RuntimeError> {
        let target_peer = self.find_peer(target_peer_id).await?;
        self.ensure_peer_is_trusted(&target_peer.peer_id, &target_peer.public_key)?;
        let target_public_key = parse_public_key(&target_peer.public_key)?;
        let sealed_payload = seal_json(
            &self.identity,
            &target_public_key,
            &serde_json::json!({
                "source_task_id": source_task_id,
            }),
        )?;
        let request_id = self.next_request_id("preflight");
        let response = self
            .send_peer_request(
                &target_peer,
                PeerRequest::PrepareTransfer {
                    request_id: request_id.clone(),
                    source_peer_id: self.config.peer_id.clone(),
                    sealed_payload,
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
            PeerResponse::StartPairing { .. } => Err(RuntimeError::Protocol(
                "unexpected pairing response during preflight".into(),
            )),
            PeerResponse::SubmitTransferPayload { .. } => Err(RuntimeError::Protocol(
                "unexpected submit-transfer response during preflight".into(),
            )),
            PeerResponse::FetchTransferArtifact { .. } => Err(RuntimeError::Protocol(
                "unexpected fetch-transfer-artifact response during preflight".into(),
            )),
            PeerResponse::ImportCommitted { .. } => Err(RuntimeError::Protocol(
                "unexpected import-committed response during preflight".into(),
            )),
            PeerResponse::FinalizeTransfer { .. } => Err(RuntimeError::Protocol(
                "unexpected finalize response during preflight".into(),
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
        self.ensure_peer_is_trusted(&target_peer.peer_id, &target_peer.public_key)?;
        let target_public_key = parse_public_key(&target_peer.public_key)?;
        let sealed_payload = seal_json(&self.identity, &target_public_key, &payload)?;
        let request_id = self.next_request_id("commit");
        let response = self
            .send_peer_request(
                &target_peer,
                PeerRequest::SubmitTransferPayload {
                    request_id: request_id.clone(),
                    transfer_id: transfer_id.to_owned(),
                    sealed_payload,
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

                Ok(())
            }
            PeerResponse::StartPairing { .. } => Err(RuntimeError::Protocol(
                "unexpected pairing response during transfer commit".into(),
            )),
            PeerResponse::PrepareTransfer { .. } => Err(RuntimeError::Protocol(
                "unexpected preflight response during transfer commit".into(),
            )),
            PeerResponse::FetchTransferArtifact { .. } => Err(RuntimeError::Protocol(
                "unexpected fetch-transfer-artifact response during transfer commit".into(),
            )),
            PeerResponse::ImportCommitted { .. } => Err(RuntimeError::Protocol(
                "unexpected import-committed response during transfer commit".into(),
            )),
            PeerResponse::FinalizeTransfer { .. } => Err(RuntimeError::Protocol(
                "unexpected finalize response during transfer commit".into(),
            )),
            PeerResponse::Error {
                request_id: _,
                message,
            } => Err(RuntimeError::Protocol(message)),
        }
    }

    pub async fn finalize_outgoing_transfer(
        &self,
        transfer_id: &str,
    ) -> Result<FinalizedOutgoingTransfer, RuntimeError> {
        let source_peer_id = {
            let mut reservations = self.incoming_reservations.lock().await;
            prune_incoming_reservations(&mut reservations, self.config.pending_transfer_ttl);
            reservations
                .get(transfer_id)
                .map(|reservation| reservation.source_peer_id.clone())
        }
        .ok_or_else(|| {
            RuntimeError::Protocol(format!(
                "missing source peer for outgoing transfer finalization {}",
                transfer_id
            ))
        })?;

        let source_peer = self.find_peer(&source_peer_id).await?;
        self.ensure_peer_is_trusted(&source_peer.peer_id, &source_peer.public_key)?;
        let source_public_key = parse_public_key(&source_peer.public_key)?;
        let request_id = self.next_request_id("finalize");
        let response = self
            .send_peer_request(
                &source_peer,
                PeerRequest::FinalizeTransfer {
                    request_id: request_id.clone(),
                    transfer_id: transfer_id.to_owned(),
                    requester_peer_id: self.config.peer_id.clone(),
                },
            )
            .await?;

        match response {
            PeerResponse::FinalizeTransfer {
                request_id: response_request_id,
                transfer_id: response_transfer_id,
                sealed_payload,
            } => {
                if response_request_id != request_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched request id in finalize response: expected {}, got {}",
                        request_id, response_request_id
                    )));
                }
                if response_transfer_id != transfer_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched transfer id in finalize response: expected {}, got {}",
                        transfer_id, response_transfer_id
                    )));
                }
                let payload = open_json(&self.identity, &source_public_key, &sealed_payload)?;
                let finalized_payload = payload.get("payload").cloned().ok_or_else(|| {
                    RuntimeError::Protocol("finalize response missing payload".into())
                })?;
                let finalized_cleanly = payload
                    .get("finalized_cleanly")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| {
                    RuntimeError::Protocol("finalize response missing finalized_cleanly".into())
                })?;
                Ok(FinalizedOutgoingTransfer {
                    payload: finalized_payload,
                    finalized_cleanly,
                })
            }
            PeerResponse::StartPairing { .. }
            | PeerResponse::PrepareTransfer { .. }
            | PeerResponse::SubmitTransferPayload { .. }
            | PeerResponse::FetchTransferArtifact { .. }
            | PeerResponse::ImportCommitted { .. } => Err(RuntimeError::Protocol(
                "unexpected response while finalizing outgoing transfer".into(),
            )),
            PeerResponse::Error {
                request_id: _,
                message,
            } => Err(RuntimeError::Protocol(message)),
        }
    }

    pub async fn complete_outgoing_transfer_finalization(
        &self,
        transfer_id: &str,
        result: Result<FinalizedOutgoingTransfer, RuntimeError>,
    ) -> Result<(), RuntimeError> {
        let sender = self
            .pending_outgoing_transfer_finalizations
            .lock()
            .await
            .remove(transfer_id)
            .ok_or_else(|| {
                RuntimeError::Protocol(format!(
                    "missing pending outgoing transfer finalization {}",
                    transfer_id
                ))
            })?;
        sender.send(result).map_err(|_| {
            RuntimeError::Protocol(format!(
                "finalization receiver dropped for transfer {}",
                transfer_id
            ))
        })
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
        self.ensure_peer_is_trusted(&source_peer.peer_id, &source_peer.public_key)?;
        let source_public_key = parse_public_key(&source_peer.public_key)?;
        let sealed_payload = seal_json(
            &self.identity,
            &source_public_key,
            &serde_json::json!({
                "artifact_id": artifact_id,
            }),
        )?;
        let request_id = self.next_request_id("fetch-artifact");
        let response = self
            .send_peer_request(
                &source_peer,
                PeerRequest::FetchTransferArtifact {
                    request_id: request_id.clone(),
                    transfer_id: transfer_id.to_owned(),
                    requester_peer_id: self.config.peer_id.clone(),
                    sealed_payload,
                },
            )
            .await?;

        match response {
            PeerResponse::FetchTransferArtifact {
                request_id: response_request_id,
                transfer_id: response_transfer_id,
                sealed_payload,
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
                let payload = open_json(&self.identity, &source_public_key, &sealed_payload)?;
                let response_artifact_id = payload
                    .get("artifact_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::Protocol("artifact fetch response missing artifact_id".into())
                    })?;
                if response_artifact_id != artifact_id {
                    return Err(RuntimeError::Protocol(format!(
                        "mismatched artifact id in artifact fetch response: expected {}, got {}",
                        artifact_id, response_artifact_id
                    )));
                }
                let filename =
                    payload
                        .get("filename")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            RuntimeError::Protocol(
                                "artifact fetch response missing filename".into(),
                            )
                        })?;
                let payload_b64 = payload
                    .get("payload_b64")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::Protocol("artifact fetch response missing payload_b64".into())
                    })?;

                let path = self
                    .materialize_transfer_artifact(transfer_id, artifact_id, filename, payload_b64)
                    .await?;
                Ok(StagedTransferArtifact { path })
            }
            PeerResponse::StartPairing { .. }
            | PeerResponse::PrepareTransfer { .. }
            | PeerResponse::SubmitTransferPayload { .. }
            | PeerResponse::ImportCommitted { .. }
            | PeerResponse::FinalizeTransfer { .. } => Err(RuntimeError::Protocol(
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
        self.ensure_peer_is_trusted(&source_peer.peer_id, &source_peer.public_key)?;
        let source_public_key = parse_public_key(&source_peer.public_key)?;
        let sealed_payload = seal_json(
            &self.identity,
            &source_public_key,
            &serde_json::json!({
                "source_task_id": source_task_id,
                "destination_local_task_id": destination_local_task_id,
            }),
        )?;
        let request_id = self.next_request_id("import-committed");
        let response = self
            .send_peer_request(
                &source_peer,
                PeerRequest::ImportCommitted {
                    request_id: request_id.clone(),
                    transfer_id: transfer_id.to_owned(),
                    requester_peer_id: self.config.peer_id.clone(),
                    sealed_payload,
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
            PeerResponse::StartPairing { .. }
            | PeerResponse::PrepareTransfer { .. }
            | PeerResponse::SubmitTransferPayload { .. }
            | PeerResponse::FetchTransferArtifact { .. }
            | PeerResponse::FinalizeTransfer { .. } => Err(RuntimeError::Protocol(
                "unexpected response while acknowledging import commit".into(),
            )),
            PeerResponse::Error {
                request_id: _,
                message,
            } => Err(RuntimeError::Protocol(message)),
        }
    }

    async fn find_peer(&self, target_peer_id: &str) -> Result<PeerRegistryEntry, RuntimeError> {
        let peers = self.discovery.list_peers(&self.config.peer_id).await?;
        peers
            .into_iter()
            .find(|peer| peer.peer_id == target_peer_id)
            .ok_or_else(|| RuntimeError::PeerNotFound(target_peer_id.to_owned()))
    }

    fn discovered_peer(&self, peer: PeerRegistryEntry) -> Result<DiscoveredPeer, RuntimeError> {
        let trusted = self
            .trusted_peer_record(&peer.peer_id)?
            .map(|record| record.public_key == peer.public_key)
            .unwrap_or(false);

        Ok(DiscoveredPeer {
            peer_id: peer.peer_id,
            display_name: peer.display_name,
            endpoint: peer.endpoint,
            pid: peer.pid,
            public_key: peer.public_key,
            protocol_version: peer.protocol_version,
            accepting_transfers: peer.accepting_transfers,
            trusted,
        })
    }

    fn trusted_peer_record(&self, peer_id: &str) -> Result<Option<PeerRecord>, RuntimeError> {
        Ok(peer_store(&self.config.registry_dir, &self.config.peer_id)?
            .list_active()?
            .into_iter()
            .find(|record| record.peer_id == peer_id))
    }

    fn upsert_trusted_peer(&self, record: PeerRecord) -> Result<(), RuntimeError> {
        peer_store(&self.config.registry_dir, &self.config.peer_id)?.upsert(record)?;
        Ok(())
    }

    fn ensure_peer_is_trusted(
        &self,
        peer_id: &str,
        observed_public_key: &str,
    ) -> Result<(), RuntimeError> {
        ensure_peer_is_trusted_for(
            &self.config.registry_dir,
            &self.config.peer_id,
            peer_id,
            observed_public_key,
        )
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
        self.discovery.shutdown();
        if let Some(registry_entry_path) = &self.registry_entry_path {
            let _ = std::fs::remove_file(registry_entry_path);
        }
        if let Ok(mut reservations) = self.incoming_reservations.try_lock() {
            reservations.clear();
        }
        if let Ok(mut pending) = self.pending_outgoing_transfer_finalizations.try_lock() {
            pending.clear();
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

async fn handle_mdns_event(state: &Arc<Mutex<MdnsState>>, event: ServiceEvent) {
    match event {
        ServiceEvent::ServiceResolved(service) => {
            let peer = match resolved_service_to_peer_entry(&service) {
                Ok(peer) => peer,
                Err(_) => return,
            };

            let mut state = state.lock().await;
            if let Some(previous_peer_id) = state
                .peer_ids_by_fullname
                .insert(service.get_fullname().to_owned(), peer.peer_id.clone())
            {
                state.peers_by_id.remove(&previous_peer_id);
            }
            state.peers_by_id.insert(peer.peer_id.clone(), peer);
        }
        ServiceEvent::ServiceRemoved(_, fullname) => {
            let mut state = state.lock().await;
            if let Some(peer_id) = state.peer_ids_by_fullname.remove(&fullname) {
                state.peers_by_id.remove(&peer_id);
            }
        }
        _ => {}
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
        Ok(PeerRequest::StartPairing {
            request_id,
            source_peer_id,
            source_display_name,
            source_public_key,
            capabilities_json,
        }) => {
            let verification_code = pairing_verification_code(
                &source_peer_id,
                &source_public_key,
                &context.self_peer_id,
                &context.self_public_key,
            );
            peer_store(&context.registry_root, &context.self_peer_id)?.upsert(PeerRecord {
                peer_id: source_peer_id.clone(),
                display_name: source_display_name.clone(),
                public_key: source_public_key.clone(),
                capabilities_json,
                paired_at: Utc::now().to_rfc3339(),
                last_seen_at: Some(Utc::now().to_rfc3339()),
                revoked_at: None,
            })?;
            context
                .incoming_sender
                .send(RuntimeEvent::PairingCompleted(PairingCompletedEvent {
                    peer_id: source_peer_id,
                    display_name: source_display_name,
                    verification_code: verification_code.clone(),
                }))
                .map_err(|_| RuntimeError::IncomingEventChannelClosed)?;
            PeerResponse::StartPairing {
                request_id,
                peer: PairingPeer {
                    peer_id: context.self_peer_id.clone(),
                    display_name: context.self_display_name.clone(),
                    public_key: context.self_public_key.clone(),
                    capabilities_json: local_capabilities_json(),
                },
                verification_code,
            }
        }
        Ok(PeerRequest::PrepareTransfer {
            request_id,
            source_peer_id,
            sealed_payload,
        }) => match async {
            let source_peer = context
                .discovery
                .list_peers(&context.self_peer_id)
                .await?
                .into_iter()
                .find(|peer| peer.peer_id == source_peer_id)
                .ok_or_else(|| {
                    RuntimeError::Protocol(format!(
                        "source peer {} is not currently discovered",
                        source_peer_id
                    ))
                })?;
            ensure_peer_is_trusted_for(
                &context.registry_root,
                &context.self_peer_id,
                &source_peer_id,
                &source_peer.public_key,
            )?;
            let source_public_key = parse_public_key(&source_peer.public_key)?;
            let identity = load_or_create_identity(&context.registry_root, &context.self_peer_id)?;
            let decrypted_payload = open_json(&identity, &source_public_key, &sealed_payload)?;
            let source_task_id = decrypted_payload
                .get("source_task_id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    RuntimeError::Protocol("prepare-transfer payload missing source_task_id".into())
                })?
                .to_string();
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

            Ok::<PeerResponse, RuntimeError>(PeerResponse::PrepareTransfer {
                request_id: request_id.clone(),
                transfer_id,
                source_peer_id,
                target_has_repo: false,
            })
        }
        .await
        {
            Ok(response) => response,
            Err(error) => PeerResponse::Error {
                request_id,
                message: error.to_string(),
            },
        },
        Ok(PeerRequest::SubmitTransferPayload {
            request_id,
            transfer_id,
            sealed_payload,
        }) => {
            match build_incoming_event(
                &context.self_peer_id,
                &context.registry_root,
                &context.discovery,
                &transfer_id,
                context.pending_transfer_ttl,
                sealed_payload,
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
        Ok(PeerRequest::FinalizeTransfer {
            request_id,
            transfer_id,
            requester_peer_id,
        }) => {
            let transfer_id_for_cleanup = transfer_id.clone();
            match async {
                let expected_target_peer_id = {
                    let mut transfers = context.outgoing_transfers.lock().await;
                    prune_outgoing_transfers(&mut transfers, context.pending_transfer_ttl);
                    transfers
                        .get(&transfer_id)
                        .map(|reservation| reservation.target_peer_id.clone())
                }
                .ok_or_else(|| {
                    RuntimeError::Protocol(format!(
                        "missing target peer for outgoing transfer finalization {}",
                        transfer_id
                    ))
                })?;

                if requester_peer_id != expected_target_peer_id {
                    return Err(RuntimeError::Protocol(format!(
                        "unexpected outgoing transfer finalization requester {} for transfer {}",
                        requester_peer_id, transfer_id
                    )));
                }

                let requester_peer = context
                    .discovery
                    .list_peers(&context.self_peer_id)
                    .await?
                    .into_iter()
                    .find(|peer| peer.peer_id == requester_peer_id)
                    .ok_or_else(|| {
                        RuntimeError::Protocol(format!(
                            "requester peer {} is not currently discovered",
                            requester_peer_id
                        ))
                    })?;
                ensure_peer_is_trusted_for(
                    &context.registry_root,
                    &context.self_peer_id,
                    &requester_peer_id,
                    &requester_peer.public_key,
                )?;

                let (tx, rx) = oneshot::channel();
                context
                    .pending_outgoing_transfer_finalizations
                    .lock()
                    .await
                    .insert(transfer_id.clone(), tx);
                context
                    .incoming_sender
                    .send(RuntimeEvent::OutgoingTransferFinalizationRequested(
                        OutgoingTransferFinalizationRequestedEvent {
                            transfer_id: transfer_id.clone(),
                        },
                    ))
                    .map_err(|_| RuntimeError::IncomingEventChannelClosed)?;

                let result = match rx.await {
                    Ok(result) => result,
                    Err(_) => Err(RuntimeError::Protocol(format!(
                        "desktop finalization receiver dropped for transfer {}",
                        transfer_id
                    ))),
                };
                let identity =
                    load_or_create_identity(&context.registry_root, &context.self_peer_id)?;
                let requester_public_key = parse_public_key(&requester_peer.public_key)?;
                match result {
                    Ok(finalized) => {
                        let sealed_payload = seal_json(
                            &identity,
                            &requester_public_key,
                            &serde_json::json!({
                                "payload": finalized.payload,
                                "finalized_cleanly": finalized.finalized_cleanly,
                            }),
                        )?;
                        Ok::<PeerResponse, RuntimeError>(PeerResponse::FinalizeTransfer {
                            request_id: request_id.clone(),
                            transfer_id,
                            sealed_payload,
                        })
                    }
                    Err(error) => Err(error),
                }
            }
            .await
            {
                Ok(response) => response,
                Err(error) => {
                    context
                        .pending_outgoing_transfer_finalizations
                        .lock()
                        .await
                        .remove(&transfer_id_for_cleanup);
                    PeerResponse::Error {
                        request_id,
                        message: error.to_string(),
                    }
                }
            }
        }
        Ok(PeerRequest::FetchTransferArtifact {
            request_id,
            transfer_id,
            requester_peer_id,
            sealed_payload,
        }) => {
            match async {
                let expected_target_peer_id = {
                    let mut transfers = context.outgoing_transfers.lock().await;
                    prune_outgoing_transfers(&mut transfers, context.pending_transfer_ttl);
                    transfers
                        .get(&transfer_id)
                        .map(|reservation| reservation.target_peer_id.clone())
                }
                .ok_or_else(|| {
                    RuntimeError::Protocol(format!(
                        "missing target peer for artifact fetch {}",
                        transfer_id
                    ))
                })?;

                if requester_peer_id != expected_target_peer_id {
                    return Err(RuntimeError::Protocol(format!(
                        "unexpected artifact fetch requester {} for transfer {}",
                        requester_peer_id, transfer_id
                    )));
                }

                let requester_peer = context
                    .discovery
                    .list_peers(&context.self_peer_id)
                    .await?
                    .into_iter()
                    .find(|peer| peer.peer_id == requester_peer_id)
                    .ok_or_else(|| {
                        RuntimeError::Protocol(format!(
                            "requester peer {} is not currently discovered",
                            requester_peer_id
                        ))
                    })?;
                ensure_peer_is_trusted_for(
                    &context.registry_root,
                    &context.self_peer_id,
                    &requester_peer_id,
                    &requester_peer.public_key,
                )?;
                let requester_public_key = parse_public_key(&requester_peer.public_key)?;
                let identity =
                    load_or_create_identity(&context.registry_root, &context.self_peer_id)?;
                let request_payload = open_json(&identity, &requester_public_key, &sealed_payload)?;
                let artifact_id = request_payload
                    .get("artifact_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::Protocol("artifact fetch request missing artifact_id".into())
                    })?;

                let mut artifacts = context.transfer_artifacts.lock().await;
                prune_transfer_artifacts(&mut artifacts, context.pending_transfer_ttl);
                match artifacts
                    .get(&transfer_id)
                    .and_then(|artifacts| artifacts.get(artifact_id))
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
                        let sealed_payload = seal_json(
                            &identity,
                            &requester_public_key,
                            &serde_json::json!({
                                "artifact_id": artifact_id,
                                "filename": filename,
                                "payload_b64": payload_b64,
                            }),
                        )?;
                        Ok::<PeerResponse, RuntimeError>(PeerResponse::FetchTransferArtifact {
                            request_id: request_id.clone(),
                            transfer_id,
                            sealed_payload,
                        })
                    }
                    None => Err(RuntimeError::Protocol(format!(
                        "missing transfer artifact {} for transfer {}",
                        artifact_id, transfer_id
                    ))),
                }
            }
            .await
            {
                Ok(response) => response,
                Err(error) => PeerResponse::Error {
                    request_id,
                    message: error.to_string(),
                },
            }
        }
        Ok(PeerRequest::ImportCommitted {
            request_id,
            transfer_id,
            requester_peer_id,
            sealed_payload,
        }) => {
            match async {
                let expected_target_peer_id = {
                    let mut transfers = context.outgoing_transfers.lock().await;
                    prune_outgoing_transfers(&mut transfers, context.pending_transfer_ttl);
                    transfers
                        .get(&transfer_id)
                        .map(|reservation| reservation.target_peer_id.clone())
                }
                .ok_or_else(|| {
                    RuntimeError::Protocol(format!(
                        "missing target peer for import acknowledgment {}",
                        transfer_id
                    ))
                })?;

                if requester_peer_id != expected_target_peer_id {
                    return Err(RuntimeError::Protocol(format!(
                        "unexpected import acknowledgment requester {} for transfer {}",
                        requester_peer_id, transfer_id
                    )));
                }

                let requester_peer = context
                    .discovery
                    .list_peers(&context.self_peer_id)
                    .await?
                    .into_iter()
                    .find(|peer| peer.peer_id == requester_peer_id)
                    .ok_or_else(|| {
                        RuntimeError::Protocol(format!(
                            "requester peer {} is not currently discovered",
                            requester_peer_id
                        ))
                    })?;
                ensure_peer_is_trusted_for(
                    &context.registry_root,
                    &context.self_peer_id,
                    &requester_peer_id,
                    &requester_peer.public_key,
                )?;
                let requester_public_key = parse_public_key(&requester_peer.public_key)?;
                let identity =
                    load_or_create_identity(&context.registry_root, &context.self_peer_id)?;
                let payload = open_json(&identity, &requester_public_key, &sealed_payload)?;
                let source_task_id = payload
                    .get("source_task_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::Protocol(
                            "import acknowledgment payload missing source_task_id".into(),
                        )
                    })?
                    .to_string();
                let destination_local_task_id = payload
                    .get("destination_local_task_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::Protocol(
                            "import acknowledgment payload missing destination_local_task_id"
                                .into(),
                        )
                    })?
                    .to_string();

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
                context.outgoing_transfers.lock().await.remove(&transfer_id);
                Ok::<PeerResponse, RuntimeError>(PeerResponse::ImportCommitted {
                    request_id: request_id.clone(),
                    transfer_id,
                })
            }
            .await
            {
                Ok(response) => response,
                Err(error) => PeerResponse::Error {
                    request_id,
                    message: error.to_string(),
                },
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
    discovery: &PeerDiscovery,
    transfer_id: &str,
    pending_transfer_ttl: Duration,
    sealed_payload: String,
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

    let source_peer = discovery
        .list_peers(self_peer_id)
        .await?
        .into_iter()
        .find(|peer| peer.peer_id == reservation.source_peer_id)
        .ok_or_else(|| {
            RuntimeError::Protocol(format!(
                "source peer {} is not currently discovered",
                reservation.source_peer_id
            ))
        })?;
    ensure_peer_is_trusted_for(
        registry_root,
        self_peer_id,
        &reservation.source_peer_id,
        &source_peer.public_key,
    )?;
    let source_public_key = parse_public_key(&source_peer.public_key)?;
    let identity = load_or_create_identity(registry_root, self_peer_id)?;
    let payload = open_json(&identity, &source_public_key, &sealed_payload)?;

    let source_task_id = payload
        .pointer("/task/source_task_id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or(reservation.source_task_id);

    let source_name = Some(source_peer.display_name);

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

fn peer_store(root: &Path, self_peer_id: &str) -> Result<PeerStore, RuntimeError> {
    Ok(PeerStore::new(root.join("trusted-peers").join(format!(
        "{}.json",
        URL_SAFE_NO_PAD.encode(self_peer_id)
    ))))
}

fn identity_path(root: &Path, self_peer_id: &str) -> PathBuf {
    root.join("transfer-identities")
        .join(format!("{}.json", URL_SAFE_NO_PAD.encode(self_peer_id)))
}

fn load_or_create_identity(
    root: &Path,
    self_peer_id: &str,
) -> Result<TransferIdentity, RuntimeError> {
    let path = identity_path(root, self_peer_id);
    if let Ok(contents) = std::fs::read_to_string(&path) {
        if !contents.trim().is_empty() {
            let stored: StoredIdentity = serde_json::from_str(&contents)?;
            return TransferIdentity::from_secret_string(&stored.secret_key)
                .map_err(|error| RuntimeError::InvalidConfig(error.to_string()));
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let identity = TransferIdentity::generate();
    let stored = StoredIdentity {
        secret_key: identity.secret_key_string(),
    };
    std::fs::write(path, serde_json::to_vec_pretty(&stored)?)?;
    Ok(identity)
}

fn local_capabilities_json() -> String {
    serde_json::json!({
        "protocolVersion": 1,
        "transferCapabilityVersion": 1,
    })
    .to_string()
}

fn ensure_peer_is_trusted_for(
    root: &Path,
    self_peer_id: &str,
    peer_id: &str,
    observed_public_key: &str,
) -> Result<(), RuntimeError> {
    let trusted = peer_store(root, self_peer_id)?
        .list_active()?
        .into_iter()
        .find(|record| record.peer_id == peer_id)
        .filter(|record| record.public_key == observed_public_key)
        .is_some();

    if trusted {
        Ok(())
    } else {
        Err(RuntimeError::Protocol(format!(
            "peer {} is not trusted",
            peer_id
        )))
    }
}

fn pairing_verification_code(
    left_peer_id: &str,
    left_public_key: &str,
    right_peer_id: &str,
    right_public_key: &str,
) -> String {
    let mut participants = [
        format!("{left_peer_id}:{left_public_key}"),
        format!("{right_peer_id}:{right_public_key}"),
    ];
    participants.sort();

    let mut hasher = Sha256::new();
    hasher.update(participants[0].as_bytes());
    hasher.update(b"|");
    hasher.update(participants[1].as_bytes());
    let digest = hasher.finalize();
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{value:06}")
}

fn unexpected_peer_response(operation: &str, response: &PeerResponse) -> RuntimeError {
    RuntimeError::Protocol(format!(
        "unexpected response while handling {}: {:?}",
        operation, response
    ))
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

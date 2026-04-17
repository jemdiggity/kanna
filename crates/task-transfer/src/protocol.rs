use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControlRequest {
    ListPeers {
        request_id: String,
    },
    StageTransferArtifact {
        request_id: String,
        transfer_id: String,
        artifact_id: String,
        path: String,
    },
    FetchTransferArtifact {
        request_id: String,
        transfer_id: String,
        artifact_id: String,
    },
    PrepareTransferPreflight {
        request_id: String,
        source_task_id: String,
        target_peer_id: String,
    },
    PrepareTransferCommit {
        request_id: String,
        transfer_id: String,
        payload: serde_json::Value,
    },
    AcknowledgeImportCommitted {
        request_id: String,
        transfer_id: String,
        source_task_id: String,
        destination_local_task_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControlResponse {
    ListPeers {
        request_id: String,
        peers: Vec<PeerRegistryEntry>,
    },
    StageTransferArtifact {
        request_id: String,
        transfer_id: String,
        artifact_id: String,
    },
    FetchTransferArtifact {
        request_id: String,
        transfer_id: String,
        artifact_id: String,
        path: String,
    },
    PrepareTransferPreflight {
        request_id: String,
        transfer_id: String,
        source_peer_id: String,
        target_has_repo: bool,
    },
    PrepareTransferCommit {
        request_id: String,
        transfer_id: String,
    },
    AcknowledgeImportCommitted {
        request_id: String,
        transfer_id: String,
    },
    Error {
        request_id: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PeerRequest {
    PrepareTransfer {
        request_id: String,
        source_task_id: String,
        source_peer_id: String,
    },
    SubmitTransferPayload {
        request_id: String,
        transfer_id: String,
        payload: serde_json::Value,
    },
    FetchTransferArtifact {
        request_id: String,
        transfer_id: String,
        artifact_id: String,
    },
    ImportCommitted {
        request_id: String,
        transfer_id: String,
        source_task_id: String,
        destination_local_task_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PeerResponse {
    PrepareTransfer {
        request_id: String,
        transfer_id: String,
        source_peer_id: String,
        target_has_repo: bool,
    },
    SubmitTransferPayload {
        request_id: String,
        transfer_id: String,
    },
    FetchTransferArtifact {
        request_id: String,
        transfer_id: String,
        artifact_id: String,
        filename: String,
        payload_b64: String,
    },
    ImportCommitted {
        request_id: String,
        transfer_id: String,
    },
    Error {
        request_id: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerRegistryEntry {
    pub peer_id: String,
    pub display_name: String,
    pub endpoint: String,
    pub pid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarEvent {
    IncomingTransferRequest {
        transfer_id: String,
        source_peer_id: String,
        source_task_id: String,
        source_name: Option<String>,
        payload: serde_json::Value,
    },
    OutgoingTransferCommitted {
        transfer_id: String,
        source_task_id: String,
        destination_local_task_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WireMessage {
    ListPeers,
    PairingRequest {
        peer_id: String,
        display_name: String,
    },
    PairingAccept {
        peer_id: String,
        code: String,
        public_key: String,
    },
    PrepareTransfer {
        transfer_id: String,
        task_id: String,
        provider: String,
    },
    PrepareTransferOk {
        transfer_id: String,
        ready_token: String,
    },
    TransferChunk {
        transfer_id: String,
        seq: u64,
        payload_b64: String,
    },
    TransferCommit {
        transfer_id: String,
    },
    TransferAck {
        transfer_id: String,
    },
    Error {
        message: String,
    },
}

use kanna_task_transfer::peer_store::{PeerRecord, PeerStore, PeerStoreError};
use kanna_task_transfer::protocol::WireMessage;
use serde_json::json;

#[test]
fn peer_store_roundtrips_and_revokes_records() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("trusted-peers.json");
    let store = PeerStore::new(path.clone());

    let record = PeerRecord {
        peer_id: "peer-alpha".into(),
        display_name: "Jeremy's MBP".into(),
        public_key: "pubkey-alpha".into(),
        capabilities_json: r#"{"version":1}"#.into(),
        paired_at: "2026-04-08T12:00:00Z".into(),
        last_seen_at: Some("2026-04-08T12:30:00Z".into()),
        revoked_at: None,
    };

    store.upsert(record.clone()).unwrap();

    let reopened = PeerStore::new(path);
    let peers = reopened.list_all().unwrap();
    assert_eq!(peers, vec![record]);

    reopened.revoke("peer-alpha").unwrap();

    let active = reopened.list_active().unwrap();
    assert!(active.is_empty());

    let all = reopened.list_all().unwrap();
    assert_eq!(all.len(), 1);
    assert!(all[0].revoked_at.is_some());
}

#[test]
fn upsert_preserves_existing_trust_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let store = PeerStore::new(temp.path().join("trusted-peers.json"));

    store
        .upsert(PeerRecord {
            peer_id: "peer-alpha".into(),
            display_name: "Original".into(),
            public_key: "pubkey-alpha".into(),
            capabilities_json: r#"{"version":1}"#.into(),
            paired_at: "2026-04-08T12:00:00Z".into(),
            last_seen_at: Some("2026-04-08T12:30:00Z".into()),
            revoked_at: Some("2026-04-08T13:00:00Z".into()),
        })
        .unwrap();

    store
        .upsert(PeerRecord {
            peer_id: "peer-alpha".into(),
            display_name: "Updated".into(),
            public_key: "pubkey-beta".into(),
            capabilities_json: r#"{"version":2}"#.into(),
            paired_at: "2026-01-01T00:00:00Z".into(),
            last_seen_at: None,
            revoked_at: None,
        })
        .unwrap();

    let peer = store.list_all().unwrap().pop().unwrap();
    assert_eq!(peer.display_name, "Updated");
    assert_eq!(peer.public_key, "pubkey-beta");
    assert_eq!(peer.capabilities_json, r#"{"version":2}"#);
    assert_eq!(peer.paired_at, "2026-04-08T12:00:00Z");
    assert_eq!(peer.last_seen_at, Some("2026-04-08T12:30:00Z".into()));
    assert_eq!(peer.revoked_at, Some("2026-04-08T13:00:00Z".into()));
}

#[test]
fn revoke_unknown_peer_returns_error() {
    let temp = tempfile::tempdir().unwrap();
    let store = PeerStore::new(temp.path().join("trusted-peers.json"));

    let error = store.revoke("missing-peer").unwrap_err();
    assert!(matches!(error, PeerStoreError::PeerNotFound(peer_id) if peer_id == "missing-peer"));
}

#[test]
fn missing_and_empty_files_are_treated_as_empty() {
    let temp = tempfile::tempdir().unwrap();
    let missing_store = PeerStore::new(temp.path().join("missing.json"));
    assert!(missing_store.list_all().unwrap().is_empty());
    assert!(missing_store.list_active().unwrap().is_empty());

    let empty_path = temp.path().join("empty.json");
    std::fs::write(&empty_path, "").unwrap();
    let empty_store = PeerStore::new(empty_path);
    assert!(empty_store.list_all().unwrap().is_empty());
    assert!(empty_store.list_active().unwrap().is_empty());
}

#[test]
fn wire_message_serializes_and_roundtrips() {
    let message = WireMessage::PrepareTransfer {
        transfer_id: "transfer-123".into(),
        task_id: "task-abc".into(),
        provider: "claude".into(),
    };

    let json = serde_json::to_value(&message).unwrap();
    assert_eq!(
        json,
        json!({
            "type": "prepare_transfer",
            "transfer_id": "transfer-123",
            "task_id": "task-abc",
            "provider": "claude",
        })
    );

    let decoded: WireMessage = serde_json::from_value(json).unwrap();
    assert_eq!(decoded, message);
}

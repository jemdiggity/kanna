use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use kanna_task_transfer::registry::{PeerRegistry, PeerRegistryEntry, RegistryError};

#[test]
fn registry_lists_live_peers_and_filters_self() {
    let temp = tempfile::tempdir().unwrap();
    let registry = PeerRegistry::new(temp.path().to_path_buf());

    registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "peer-self".into(),
            display_name: "Primary".into(),
            endpoint: "127.0.0.1:4455".into(),
            pid: std::process::id(),
        })
        .unwrap();
    registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "peer-other".into(),
            display_name: "Secondary".into(),
            endpoint: "127.0.0.1:4456".into(),
            pid: std::process::id(),
        })
        .unwrap();

    let peers = registry.list_peers("peer-self").unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].peer_id, "peer-other");
}

#[test]
fn registry_prunes_zero_pid_entries() {
    let temp = tempfile::tempdir().unwrap();
    let registry = PeerRegistry::new(temp.path().to_path_buf());

    registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "peer-live".into(),
            display_name: "Live".into(),
            endpoint: "127.0.0.1:4457".into(),
            pid: std::process::id(),
        })
        .unwrap();
    registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "peer-stale".into(),
            display_name: "Stale".into(),
            endpoint: "127.0.0.1:4458".into(),
            pid: 0,
        })
        .unwrap();

    let peers = registry.list_peers("peer-self").unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].peer_id, "peer-live");
}

#[test]
fn registry_skips_corrupt_entries_without_failing_the_directory() {
    let temp = tempfile::tempdir().unwrap();
    let registry = PeerRegistry::new(temp.path().to_path_buf());

    registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "peer-good".into(),
            display_name: "Good".into(),
            endpoint: "127.0.0.1:4459".into(),
            pid: std::process::id(),
        })
        .unwrap();

    std::fs::write(temp.path().join("broken.json"), "{not-json").unwrap();

    let peers = registry.list_peers("peer-self").unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].peer_id, "peer-good");
    assert!(!temp.path().join("broken.json").exists());
}

#[test]
fn registry_prunes_stale_nonzero_pid_entries() {
    let temp = tempfile::tempdir().unwrap();
    let registry = PeerRegistry::new(temp.path().to_path_buf());

    registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "peer-live".into(),
            display_name: "Live".into(),
            endpoint: "127.0.0.1:4460".into(),
            pid: std::process::id(),
        })
        .unwrap();
    registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "peer-stale".into(),
            display_name: "Stale".into(),
            endpoint: "127.0.0.1:4461".into(),
            pid: 999_999,
        })
        .unwrap();

    let peers = registry.list_peers("peer-self").unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].peer_id, "peer-live");
    assert!(!temp
        .path()
        .join(format!("{}.json", URL_SAFE_NO_PAD.encode("peer-stale")))
        .exists());
}

#[test]
fn registry_rejects_path_like_peer_ids() {
    let temp = tempfile::tempdir().unwrap();
    let registry_root = temp.path().join("registry");
    let registry = PeerRegistry::new(registry_root.clone());

    let error = registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "../outside".into(),
            display_name: "Outside".into(),
            endpoint: "127.0.0.1:4462".into(),
            pid: std::process::id(),
        })
        .unwrap_err();
    assert!(matches!(error, RegistryError::InvalidPeerId));
    assert!(!temp.path().join("outside.json").exists());
    assert!(!registry_root.exists());

    let error = registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "nested/peer".into(),
            display_name: "Nested".into(),
            endpoint: "127.0.0.1:4463".into(),
            pid: std::process::id(),
        })
        .unwrap_err();
    assert!(matches!(error, RegistryError::InvalidPeerId));
    assert!(!registry_root.join("nested").exists());
}

#[test]
fn registry_skips_and_prunes_invalid_peer_ids_on_read() {
    let temp = tempfile::tempdir().unwrap();
    let registry = PeerRegistry::new(temp.path().to_path_buf());

    std::fs::write(
        temp.path().join("bad-entry.json"),
        format!(
            r#"{{"peer_id":"../outside","display_name":"Bad","endpoint":"127.0.0.1:4464","pid":{}}}"#,
            std::process::id()
        ),
    )
    .unwrap();
    registry
        .write_entry(&PeerRegistryEntry {
            peer_id: "peer-good".into(),
            display_name: "Good".into(),
            endpoint: "127.0.0.1:4465".into(),
            pid: std::process::id(),
        })
        .unwrap();

    let peers = registry.list_peers("peer-self").unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].peer_id, "peer-good");
    assert!(!temp.path().join("bad-entry.json").exists());
}

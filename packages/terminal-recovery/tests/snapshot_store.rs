use kanna_terminal_recovery::protocol::RecoverySnapshot;
use kanna_terminal_recovery::snapshot_store::SnapshotStore;

#[test]
fn snapshot_store_roundtrips_snapshot_files() {
    let tempdir = tempfile::tempdir().expect("tempdir should exist");
    let store = SnapshotStore::new(tempdir.path());
    let snapshot = RecoverySnapshot {
        session_id: "session-1".to_string(),
        serialized: "prompt>".to_string(),
        cols: 100,
        rows: 30,
        cursor_row: 4,
        cursor_col: 5,
        cursor_visible: true,
        saved_at: 10,
        sequence: 11,
    };

    store.write(&snapshot).expect("write should succeed");

    let restored = store
        .require("session-1")
        .expect("stored snapshot should roundtrip");
    assert_eq!(restored, snapshot);
}

#[test]
fn snapshot_store_rejects_invalid_payloads() {
    let tempdir = tempfile::tempdir().expect("tempdir should exist");
    let store = SnapshotStore::new(tempdir.path());
    let path = tempdir.path().join("session-bad.json");
    std::fs::write(&path, b"{\"sessionId\":\"session-bad\",\"serialized\":1}")
        .expect("should seed invalid json payload");

    let error = store
        .require("session-bad")
        .expect_err("invalid snapshots should fail");

    assert!(error.to_lowercase().contains("persisted snapshot"));
}

#[test]
fn snapshot_store_remove_is_idempotent() {
    let tempdir = tempfile::tempdir().expect("tempdir should exist");
    let store = SnapshotStore::new(tempdir.path());

    store
        .remove("missing")
        .expect("remove should ignore missing files");
}

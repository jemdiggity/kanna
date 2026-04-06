use kanna_terminal_recovery::protocol::RecoverySnapshot;
use kanna_terminal_recovery::session_mirror::SessionMirror;

#[test]
fn mirror_serializes_full_scrollback_after_multiple_writes() {
    let mut mirror = SessionMirror::new("session-1", 120, 45).expect("mirror should initialize");
    mirror.write_output(b"line 1\r\n", 1);
    mirror.write_output(b"line 2\r\n", 2);
    mirror.write_output(b"prompt>", 3);

    let snapshot = mirror.snapshot().expect("snapshot should succeed");

    assert!(snapshot.serialized.contains("line 1"));
    assert!(snapshot.serialized.contains("line 2"));
    assert!(snapshot.serialized.contains("prompt>"));
    assert_eq!(snapshot.sequence, 3);
}

#[test]
fn mirror_restores_cursor_state_from_snapshot() {
    let snapshot = RecoverySnapshot {
        session_id: "session-2".to_string(),
        serialized: "hello".to_string(),
        cols: 80,
        rows: 24,
        cursor_row: 1,
        cursor_col: 2,
        cursor_visible: true,
        saved_at: 1,
        sequence: 7,
    };

    let mut mirror = SessionMirror::new("session-2", 80, 24).expect("mirror should initialize");
    mirror.restore(&snapshot).expect("restore should succeed");

    let restored = mirror.snapshot().expect("snapshot should succeed");
    assert!(restored.serialized.contains("hello"));
    assert_eq!(restored.cursor_row, 1);
    assert_eq!(restored.cursor_col, 2);
    assert_eq!(restored.sequence, 7);
}

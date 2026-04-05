use kanna_daemon::recovery::RecoveryManager;

#[tokio::test]
async fn recovery_service_returns_none_when_snapshot_is_missing() {
    let manager = RecoveryManager::disconnected();

    let snapshot = manager
        .get_snapshot("task-missing")
        .await
        .expect("disconnected manager should degrade to no snapshot");

    assert!(snapshot.is_none());
}

#[tokio::test]
async fn recovery_service_sequences_increment_per_session() {
    let manager = RecoveryManager::disconnected();

    assert_eq!(manager.next_sequence("task-1"), 1);
    assert_eq!(manager.next_sequence("task-1"), 2);
    assert_eq!(manager.next_sequence("task-2"), 1);
    assert_eq!(manager.next_sequence("task-1"), 3);
}

#[tokio::test]
async fn recovery_service_mirrors_live_output_and_geometry() {
    let manager = RecoveryManager::new_for_test()
        .await
        .expect("test recovery manager should start");

    manager
        .start_session("task-live", 80, 24, false)
        .await
        .expect("start_session should succeed");
    manager.write_output("task-live", b"hello", 1).await;
    manager.write_output("task-live", b" world", 2).await;
    manager.resize_session("task-live", 100, 30).await;

    let snapshot = manager
        .get_snapshot("task-live")
        .await
        .expect("snapshot request should succeed")
        .expect("live session snapshot should exist");

    assert_eq!(snapshot.cols, 100);
    assert_eq!(snapshot.rows, 30);
    assert_eq!(snapshot.sequence, 2);
    assert!(snapshot.serialized.contains("hello world"));

    manager.flush_and_shutdown().await;
}

#[tokio::test]
async fn recovery_service_flushes_snapshot_before_shutdown() {
    let manager = RecoveryManager::new_for_test()
        .await
        .expect("test recovery manager should start");

    manager
        .start_session("task-persisted", 80, 24, false)
        .await
        .expect("start_session should succeed");
    manager
        .write_output("task-persisted", b"persist me", 1)
        .await;
    manager.flush_and_shutdown().await;

    let snapshot_path = manager.snapshot_file_for_test("task-persisted");
    let serialized =
        std::fs::read_to_string(snapshot_path).expect("flush should persist a snapshot file");

    assert!(serialized.contains("\"sequence\":1"));
    assert!(serialized.contains("persist me"));
}

#[tokio::test]
async fn recovery_service_resumes_existing_session_from_disk_after_restart() {
    let manager = RecoveryManager::new_for_test()
        .await
        .expect("test recovery manager should start");
    let snapshot_path = manager.snapshot_file_for_test("task-resume");
    let snapshot_dir = snapshot_path
        .parent()
        .expect("snapshot path should have a parent")
        .to_path_buf();

    manager
        .start_session("task-resume", 80, 24, false)
        .await
        .expect("initial start_session should succeed");
    manager.write_output("task-resume", b"persisted", 1).await;
    manager.flush_and_shutdown().await;

    let resumed_manager = RecoveryManager::new_for_test_with_snapshot_dir(snapshot_dir)
        .await
        .expect("replacement recovery manager should start");

    resumed_manager
        .start_session("task-resume", 80, 24, true)
        .await
        .expect("resumed start_session should succeed");

    let snapshot = resumed_manager
        .get_snapshot("task-resume")
        .await
        .expect("snapshot request should succeed")
        .expect("resumed session snapshot should exist");

    assert_eq!(snapshot.sequence, 1);
    assert!(snapshot.serialized.contains("persisted"));

    resumed_manager.flush_and_shutdown().await;
}

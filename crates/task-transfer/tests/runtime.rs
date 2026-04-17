use kanna_task_transfer::runtime::{RuntimeConfig, RuntimeEvent, TransferRuntime};
use serde_json::json;
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn primary_runtime_can_send_a_real_incoming_transfer_to_secondary() {
    let temp = tempfile::tempdir().unwrap();

    let secondary = TransferRuntime::spawn(RuntimeConfig::for_tests(
        "peer-secondary",
        "Secondary",
        temp.path(),
        0,
    ))
    .await
    .unwrap();

    let primary = TransferRuntime::spawn(RuntimeConfig::for_tests(
        "peer-primary",
        "Primary",
        temp.path(),
        0,
    ))
    .await
    .unwrap();

    let peers = primary.list_peers().await.unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].peer_id, "peer-secondary");
    assert_ne!(peers[0].endpoint, "127.0.0.1:0");

    let preflight = primary
        .prepare_transfer_preflight("peer-secondary", "task-source")
        .await
        .unwrap();
    assert_eq!(preflight.source_peer_id, "peer-primary");
    assert!(!preflight.target_has_repo);

    primary
        .prepare_transfer_commit(
            &preflight.transfer_id,
            json!({
                "target_peer_id": "peer-secondary",
                "task": {
                    "source_task_id": "task-source"
                }
            }),
        )
        .await
        .unwrap();

    let event = secondary.next_event().await.unwrap();
    let RuntimeEvent::IncomingTransferRequest(event) = event else {
        panic!("expected incoming transfer event");
    };
    assert_eq!(event.transfer_id, preflight.transfer_id);
    assert_eq!(event.source_peer_id, "peer-primary");
    assert_eq!(event.source_task_id, "task-source");
    assert_eq!(event.source_name.as_deref(), Some("Primary"));
    assert_eq!(
        event.payload,
        json!({
            "target_peer_id": "peer-secondary",
            "task": {
                "source_task_id": "task-source"
            }
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn commit_ack_stays_responsive_when_secondary_events_are_not_drained() {
    let temp = tempfile::tempdir().unwrap();

    let _secondary = TransferRuntime::spawn(RuntimeConfig::for_tests(
        "peer-secondary",
        "Secondary",
        temp.path(),
        0,
    ))
    .await
    .unwrap();

    let primary = TransferRuntime::spawn(RuntimeConfig::for_tests(
        "peer-primary",
        "Primary",
        temp.path(),
        0,
    ))
    .await
    .unwrap();

    for transfer_index in 0..40 {
        let preflight = primary
            .prepare_transfer_preflight("peer-secondary", &format!("task-{transfer_index}"))
            .await
            .unwrap();

        let commit = primary.prepare_transfer_commit(
            &preflight.transfer_id,
            json!({
                "target_peer_id": "peer-secondary",
                "task": {
                    "source_task_id": format!("task-{transfer_index}")
                }
            }),
        );

        tokio::time::timeout(Duration::from_millis(200), commit)
            .await
            .expect("commit ack should not block on event backpressure")
            .unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn expired_preflight_commit_is_rejected_and_emits_no_incoming_event() {
    let temp = tempfile::tempdir().unwrap();

    let secondary = TransferRuntime::spawn(
        RuntimeConfig::for_tests("peer-secondary", "Secondary", temp.path(), 0)
            .with_pending_transfer_ttl(Duration::from_millis(25)),
    )
    .await
    .unwrap();

    let primary = TransferRuntime::spawn(
        RuntimeConfig::for_tests("peer-primary", "Primary", temp.path(), 0)
            .with_pending_transfer_ttl(Duration::from_millis(25)),
    )
    .await
    .unwrap();

    let first = primary
        .prepare_transfer_preflight("peer-secondary", "task-stale")
        .await
        .unwrap();
    assert!(!first.transfer_id.is_empty());

    tokio::time::sleep(Duration::from_millis(40)).await;

    let commit_error = primary
        .prepare_transfer_commit(
            &first.transfer_id,
            json!({
                "target_peer_id": "peer-secondary",
                "task": {
                    "source_task_id": "task-stale"
                }
            }),
        )
        .await
        .unwrap_err();
    assert!(commit_error.to_string().contains("missing target peer"));

    tokio::time::timeout(Duration::from_millis(100), secondary.next_event())
        .await
        .expect_err("expired commits must not emit incoming events");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn destination_can_acknowledge_import_commit_back_to_source() {
    let temp = tempfile::tempdir().unwrap();

    let secondary = TransferRuntime::spawn(RuntimeConfig::for_tests(
        "peer-secondary",
        "Secondary",
        temp.path(),
        0,
    ))
    .await
    .unwrap();

    let primary = TransferRuntime::spawn(RuntimeConfig::for_tests(
        "peer-primary",
        "Primary",
        temp.path(),
        0,
    ))
    .await
    .unwrap();

    let preflight = primary
        .prepare_transfer_preflight("peer-secondary", "task-source")
        .await
        .unwrap();

    primary
        .prepare_transfer_commit(
            &preflight.transfer_id,
            json!({
                "target_peer_id": "peer-secondary",
                "task": {
                    "source_task_id": "task-source"
                }
            }),
        )
        .await
        .unwrap();

    let incoming = secondary.next_event().await.unwrap();
    let RuntimeEvent::IncomingTransferRequest(_incoming) = incoming else {
        panic!("expected incoming transfer event");
    };

    secondary
        .acknowledge_import_committed(&preflight.transfer_id, "task-source", "task-dest")
        .await
        .unwrap();

    let ack = primary.next_event().await.unwrap();
    let RuntimeEvent::OutgoingTransferCommitted(ack) = ack else {
        panic!("expected outgoing transfer committed event");
    };
    assert_eq!(ack.transfer_id, preflight.transfer_id);
    assert_eq!(ack.source_task_id, "task-source");
    assert_eq!(ack.destination_local_task_id, "task-dest");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn staged_transfer_artifacts_can_be_fetched_by_transfer_and_artifact_id() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = TransferRuntime::spawn(RuntimeConfig::for_tests(
        "peer-primary",
        "Primary",
        temp.path(),
        0,
    ))
    .await
    .unwrap();
    let bundle_path = temp.path().join("transfer-1.bundle");
    std::fs::write(&bundle_path, b"bundle").unwrap();

    runtime
        .stage_transfer_artifact("transfer-1", "artifact-1", bundle_path.clone())
        .await
        .unwrap();

    let fetched = runtime
        .fetch_transfer_artifact("transfer-1", "artifact-1")
        .await
        .unwrap();

    assert_eq!(fetched.path, bundle_path);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn destination_fetches_staged_transfer_artifacts_from_the_source_peer() {
    let temp = tempfile::tempdir().unwrap();

    let source = TransferRuntime::spawn(RuntimeConfig::for_tests(
        "peer-source",
        "Source",
        temp.path(),
        0,
    ))
    .await
    .unwrap();
    let destination = TransferRuntime::spawn(RuntimeConfig::for_tests(
        "peer-destination",
        "Destination",
        temp.path(),
        0,
    ))
    .await
    .unwrap();

    let bundle_path = temp.path().join("source.bundle");
    let bundle_bytes = b"bundle-contents";
    std::fs::write(&bundle_path, bundle_bytes).unwrap();

    let preflight = source
        .prepare_transfer_preflight("peer-destination", "task-source")
        .await
        .unwrap();
    source
        .stage_transfer_artifact(
            &preflight.transfer_id,
            "artifact-remote",
            bundle_path.clone(),
        )
        .await
        .unwrap();
    source
        .prepare_transfer_commit(
            &preflight.transfer_id,
            json!({
                "target_peer_id": "peer-destination",
                "task": {
                    "source_task_id": "task-source"
                }
            }),
        )
        .await
        .unwrap();

    let RuntimeEvent::IncomingTransferRequest(event) = destination.next_event().await.unwrap()
    else {
        panic!("expected incoming transfer event");
    };
    assert_eq!(event.transfer_id, preflight.transfer_id);

    let fetched = destination
        .fetch_transfer_artifact(&preflight.transfer_id, "artifact-remote")
        .await
        .unwrap();

    assert_ne!(fetched.path, bundle_path);
    assert_eq!(std::fs::read(&fetched.path).unwrap(), bundle_bytes);
}

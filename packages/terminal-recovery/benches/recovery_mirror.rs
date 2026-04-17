use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use kanna_terminal_recovery::bench::transcript::{
    BenchmarkMode, BenchmarkProvider, TranscriptSpec,
};
use kanna_terminal_recovery::protocol::RecoveryCommand;
use kanna_terminal_recovery::service::RecoveryService;
use kanna_terminal_recovery::session_mirror::SessionMirror;
use kanna_terminal_recovery::snapshot_store::SnapshotStore;

fn replay_mirror_case(provider: BenchmarkProvider, mode: BenchmarkMode, sessions: usize) {
    let transcript = TranscriptSpec::new(provider, mode).build();
    let mut mirrors = (0..sessions)
        .map(|index| SessionMirror::new(format!("session-{index}"), 120, 40).unwrap())
        .collect::<Vec<_>>();

    for chunk in &transcript.chunks {
        for (index, mirror) in mirrors.iter_mut().enumerate() {
            mirror.write_output(black_box(&chunk.bytes), (index as u64) + chunk.at_ms + 1);
        }
    }
}

fn replay_mirror_snapshot_case(provider: BenchmarkProvider, mode: BenchmarkMode, sessions: usize) {
    let transcript = TranscriptSpec::new(provider, mode).build();
    let mut mirrors = (0..sessions)
        .map(|index| SessionMirror::new(format!("session-{index}"), 120, 40).unwrap())
        .collect::<Vec<_>>();

    for chunk in &transcript.chunks {
        for (index, mirror) in mirrors.iter_mut().enumerate() {
            mirror.write_output(black_box(&chunk.bytes), (index as u64) + chunk.at_ms + 1);
        }
    }

    for mirror in &mirrors {
        let snapshot = mirror.snapshot().unwrap();
        black_box(snapshot);
    }
}

fn new_service() -> (tempfile::TempDir, RecoveryService) {
    let tempdir = tempfile::tempdir().unwrap();
    let store = SnapshotStore::new(tempdir.path());
    let service = RecoveryService::new_with_persist_debounce_ms(store, u64::MAX);
    (tempdir, service)
}

fn replay_service_case(provider: BenchmarkProvider, mode: BenchmarkMode, sessions: usize) {
    let transcript = TranscriptSpec::new(provider, mode).build();
    let (_tempdir, mut service) = new_service();

    for index in 0..sessions {
        let response = service.handle_command(RecoveryCommand::StartSession {
            session_id: format!("session-{index}"),
            cols: 120,
            rows: 40,
            resume_from_disk: false,
        });
        assert!(matches!(
            response,
            kanna_terminal_recovery::protocol::RecoveryResponse::Ok
        ));
    }

    for chunk in &transcript.chunks {
        for index in 0..sessions {
            let response = service.handle_command(RecoveryCommand::WriteOutput {
                session_id: format!("session-{index}"),
                data: black_box(chunk.bytes.clone()),
                sequence: (index as u64) + chunk.at_ms + 1,
            });
            assert!(matches!(
                response,
                kanna_terminal_recovery::protocol::RecoveryResponse::Ok
            ));
        }
    }
}

fn replay_service_snapshot_case(provider: BenchmarkProvider, mode: BenchmarkMode, sessions: usize) {
    let transcript = TranscriptSpec::new(provider, mode).build();
    let (_tempdir, mut service) = new_service();

    for index in 0..sessions {
        let response = service.handle_command(RecoveryCommand::StartSession {
            session_id: format!("session-{index}"),
            cols: 120,
            rows: 40,
            resume_from_disk: false,
        });
        assert!(matches!(
            response,
            kanna_terminal_recovery::protocol::RecoveryResponse::Ok
        ));
    }

    for chunk in &transcript.chunks {
        for index in 0..sessions {
            let response = service.handle_command(RecoveryCommand::WriteOutput {
                session_id: format!("session-{index}"),
                data: black_box(chunk.bytes.clone()),
                sequence: (index as u64) + chunk.at_ms + 1,
            });
            assert!(matches!(
                response,
                kanna_terminal_recovery::protocol::RecoveryResponse::Ok
            ));
        }
    }

    for index in 0..sessions {
        let response = service.handle_command(RecoveryCommand::GetSnapshot {
            session_id: format!("session-{index}"),
        });
        assert!(matches!(
            response,
            kanna_terminal_recovery::protocol::RecoveryResponse::Snapshot { .. }
        ));
        black_box(response);
    }
}

fn bench_recovery_mirror(c: &mut Criterion) {
    let mut group = c.benchmark_group("recovery_mirror");

    for provider in [
        BenchmarkProvider::Codex,
        BenchmarkProvider::Claude,
        BenchmarkProvider::Copilot,
    ] {
        for mode in [BenchmarkMode::Steady, BenchmarkMode::WorstCase] {
            for session_count in [1_usize, 10_usize] {
                let case_name = format!("{provider:?}_{mode:?}_{session_count}sessions");

                group.bench_function(format!("{case_name}/mirror_write_only"), |b| {
                    b.iter_batched(
                        || (),
                        |_| replay_mirror_case(provider, mode, session_count),
                        BatchSize::SmallInput,
                    );
                });

                group.bench_function(format!("{case_name}/mirror_write_plus_snapshot"), |b| {
                    b.iter_batched(
                        || (),
                        |_| replay_mirror_snapshot_case(provider, mode, session_count),
                        BatchSize::SmallInput,
                    );
                });

                group.bench_function(format!("{case_name}/service_write_only"), |b| {
                    b.iter_batched(
                        || (),
                        |_| replay_service_case(provider, mode, session_count),
                        BatchSize::SmallInput,
                    );
                });

                group.bench_function(format!("{case_name}/service_write_plus_snapshot"), |b| {
                    b.iter_batched(
                        || (),
                        |_| replay_service_snapshot_case(provider, mode, session_count),
                        BatchSize::SmallInput,
                    );
                });
            }
        }
    }

    group.finish();
}

criterion_group!(benches, bench_recovery_mirror);
criterion_main!(benches);

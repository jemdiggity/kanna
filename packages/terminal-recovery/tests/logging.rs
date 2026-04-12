use kanna_terminal_recovery::logging::{log_file_path, RecoveryLogger};

#[test]
fn writes_startup_and_shutdown_entries_to_dedicated_log_file() {
    let tempdir = tempfile::tempdir().expect("tempdir should exist");
    let log_path = log_file_path(tempdir.path());

    let logger = RecoveryLogger::init(tempdir.path()).expect("logger should initialize");
    logger
        .log("startup: snapshot_dir initialized")
        .expect("startup log should write");
    logger
        .log("shutdown: service stopped cleanly")
        .expect("shutdown log should write");

    let contents =
        std::fs::read_to_string(&log_path).expect("recovery log file should be readable");
    assert!(contents.contains("startup: snapshot_dir initialized"));
    assert!(contents.contains("shutdown: service stopped cleanly"));
}

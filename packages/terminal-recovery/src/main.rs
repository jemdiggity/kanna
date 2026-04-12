use std::path::PathBuf;

use kanna_terminal_recovery::logging::RecoveryLogger;
use kanna_terminal_recovery::service::RecoveryService;
use kanna_terminal_recovery::snapshot_store::SnapshotStore;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let snapshot_dir = snapshot_dir();
    let logger = RecoveryLogger::init(&snapshot_dir)?;
    logger.log(&format!(
        "startup: pid={} snapshot_dir={}",
        std::process::id(),
        snapshot_dir.display()
    ))?;

    let snapshot_store = SnapshotStore::new(snapshot_dir);
    let mut service = RecoveryService::new(snapshot_store);
    let result = service.run(std::io::stdin(), std::io::stdout().lock());

    match &result {
        Ok(()) => {
            logger.log("shutdown: service stopped cleanly")?;
        }
        Err(error) => {
            logger.log(&format!("shutdown: service stopped with error: {error}"))?;
        }
    }

    result
}

fn snapshot_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("KANNA_TERMINAL_RECOVERY_DIR") {
        return PathBuf::from(dir);
    }

    if let Ok(dir) = std::env::var("KANNA_DAEMON_DIR") {
        return PathBuf::from(dir).join("terminal-recovery");
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Kanna")
        .join("terminal-recovery")
}

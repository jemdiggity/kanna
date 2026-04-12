use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn log_file_path(snapshot_dir: &Path) -> PathBuf {
    snapshot_dir.join("kanna-terminal-recovery.log")
}

pub struct RecoveryLogger {
    file: Mutex<File>,
}

impl RecoveryLogger {
    pub fn init(snapshot_dir: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(snapshot_dir)?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_file_path(snapshot_dir))?;
        Ok(Self {
            file: Mutex::new(file),
        })
    }

    pub fn log(&self, message: &str) -> std::io::Result<()> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut file = self
            .file
            .lock()
            .map_err(|_| std::io::Error::other("recovery logger mutex poisoned"))?;
        writeln!(file, "[{}] {}", timestamp, message)?;
        file.flush()
    }
}

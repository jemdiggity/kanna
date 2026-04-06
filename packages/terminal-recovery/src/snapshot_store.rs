use std::path::{Path, PathBuf};

use crate::protocol::RecoverySnapshot;

#[derive(Clone)]
pub struct SnapshotStore {
    root: PathBuf,
}

impl SnapshotStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn write(&self, snapshot: &RecoverySnapshot) -> Result<(), String> {
        let file_path = self.file_path(&snapshot.session_id);
        let temp_path =
            file_path.with_extension(format!("json.tmp-{}-{}", std::process::id(), now_millis()));
        std::fs::create_dir_all(file_path.parent().unwrap_or_else(|| Path::new(".")))
            .map_err(|error| format!("failed to create snapshot dir {:?}: {}", self.root, error))?;
        let payload = serde_json::to_vec(snapshot).map_err(|error| {
            format!(
                "failed to serialize snapshot {}: {}",
                snapshot.session_id, error
            )
        })?;
        std::fs::write(&temp_path, payload)
            .map_err(|error| format!("failed to write snapshot {:?}: {}", temp_path, error))?;
        std::fs::rename(&temp_path, &file_path)
            .map_err(|error| format!("failed to publish snapshot {:?}: {}", file_path, error))?;
        Ok(())
    }

    pub fn read(&self, session_id: &str) -> Result<Option<RecoverySnapshot>, String> {
        let path = self.file_path(session_id);
        if !path.exists() {
            return Ok(None);
        }

        self.require(session_id).map(Some)
    }

    pub fn require(&self, session_id: &str) -> Result<RecoverySnapshot, String> {
        let path = self.file_path(session_id);
        let contents = std::fs::read_to_string(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "missing persisted snapshot for resumed session: {}",
                    session_id
                )
            } else {
                format!(
                    "invalid persisted snapshot for resumed session: {}",
                    session_id
                )
            }
        })?;
        let snapshot: RecoverySnapshot = serde_json::from_str(&contents).map_err(|_| {
            format!(
                "invalid persisted snapshot for resumed session: {}",
                session_id
            )
        })?;
        if snapshot.session_id != session_id {
            return Err(format!(
                "snapshot file {:?} contained mismatched session id {}",
                path, snapshot.session_id
            ));
        }
        Ok(snapshot)
    }

    pub fn remove(&self, session_id: &str) -> Result<(), String> {
        let path = self.file_path(session_id);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("failed to remove snapshot {:?}: {}", path, error)),
        }
    }

    fn file_path(&self, session_id: &str) -> PathBuf {
        self.root.join(format!("{}.json", session_id))
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

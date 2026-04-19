use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerRecord {
    pub peer_id: String,
    pub display_name: String,
    pub public_key: String,
    pub capabilities_json: String,
    pub paired_at: String,
    pub last_seen_at: Option<String>,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Error)]
pub enum PeerStoreError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("peer not found: {0}")]
    PeerNotFound(String),
}

pub struct PeerStore {
    path: PathBuf,
}

impl PeerStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn list_all(&self) -> Result<Vec<PeerRecord>, PeerStoreError> {
        self.read_all()
    }

    pub fn list_active(&self) -> Result<Vec<PeerRecord>, PeerStoreError> {
        Ok(self
            .read_all()?
            .into_iter()
            .filter(|record| record.revoked_at.is_none())
            .collect())
    }

    pub fn upsert(&self, record: PeerRecord) -> Result<(), PeerStoreError> {
        let mut records = self.read_all()?;
        if let Some(existing) = records
            .iter_mut()
            .find(|existing| existing.peer_id == record.peer_id)
        {
            let merged = PeerRecord {
                peer_id: existing.peer_id.clone(),
                display_name: record.display_name,
                public_key: record.public_key,
                capabilities_json: record.capabilities_json,
                paired_at: existing.paired_at.clone(),
                last_seen_at: record
                    .last_seen_at
                    .or_else(|| existing.last_seen_at.clone()),
                revoked_at: record.revoked_at.or_else(|| existing.revoked_at.clone()),
            };
            *existing = merged;
        } else {
            records.push(record);
        }
        self.write_all(&records)
    }

    pub fn revoke(&self, peer_id: &str) -> Result<(), PeerStoreError> {
        let mut records = self.read_all()?;
        let revoked_at = Utc::now().to_rfc3339();
        let mut found = false;
        for record in &mut records {
            if record.peer_id == peer_id {
                record.revoked_at = Some(revoked_at.clone());
                found = true;
            }
        }
        if !found {
            return Err(PeerStoreError::PeerNotFound(peer_id.to_owned()));
        }
        self.write_all(&records)
    }

    fn read_all(&self) -> Result<Vec<PeerRecord>, PeerStoreError> {
        match fs::read_to_string(&self.path) {
            Ok(contents) => {
                if contents.trim().is_empty() {
                    Ok(Vec::new())
                } else {
                    Ok(serde_json::from_str(&contents)?)
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        }
    }

    fn write_all(&self, records: &[PeerRecord]) -> Result<(), PeerStoreError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let payload = serde_json::to_vec_pretty(records)?;
        self.write_atomic(&payload)?;
        Ok(())
    }

    fn write_atomic(&self, payload: &[u8]) -> Result<(), PeerStoreError> {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        let temp_path = self.atomic_temp_path(parent);
        let result = (|| -> Result<(), PeerStoreError> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)?;
            file.write_all(payload)?;
            file.sync_all()?;
            fs::rename(&temp_path, &self.path)?;
            Ok(())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }

        result
    }

    fn atomic_temp_path(&self, parent: &Path) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let mut temp_name = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("peer-store")
            .to_owned();
        temp_name.push('.');
        temp_name.push_str(&process::id().to_string());
        temp_name.push('.');
        temp_name.push_str(&nanos.to_string());
        temp_name.push_str(".tmp");
        parent.join(temp_name)
    }
}

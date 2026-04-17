use crate::discovery::{validate_peer_id, DiscoveryError};
pub use crate::protocol::PeerRegistryEntry;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use std::convert::TryFrom;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid peer id")]
    InvalidPeerId,
}

pub struct PeerRegistry {
    root: PathBuf,
}

impl PeerRegistry {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn write_entry(&self, entry: &PeerRegistryEntry) -> Result<(), RegistryError> {
        validate_peer_id(&entry.peer_id).map_err(|error| match error {
            DiscoveryError::InvalidPeerId => RegistryError::InvalidPeerId,
            _ => RegistryError::InvalidPeerId,
        })?;
        fs::create_dir_all(&self.root)?;
        let path = self.entry_path(&entry.peer_id);
        let payload = serde_json::to_vec_pretty(entry)?;
        self.write_atomic(&path, &payload)?;
        Ok(())
    }

    pub fn list_peers(&self, self_peer_id: &str) -> Result<Vec<PeerRegistryEntry>, RegistryError> {
        let mut peers = Vec::new();
        if !self.root.exists() {
            return Ok(peers);
        }

        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }

            let contents = match fs::read_to_string(&path) {
                Ok(contents) => contents,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };

            let peer: PeerRegistryEntry = match serde_json::from_str(&contents) {
                Ok(peer) => peer,
                Err(_) => {
                    let _ = fs::remove_file(&path);
                    continue;
                }
            };

            if validate_peer_id(&peer.peer_id).is_err() {
                let _ = fs::remove_file(&path);
                continue;
            }

            if peer.peer_id == self_peer_id {
                continue;
            }

            if !self.pid_is_live(peer.pid) {
                let _ = fs::remove_file(&path);
                continue;
            }

            peers.push(peer);
        }

        peers.sort_by(|left, right| left.peer_id.cmp(&right.peer_id));
        Ok(peers)
    }

    fn entry_path(&self, peer_id: &str) -> PathBuf {
        self.root.join(self.file_name(peer_id))
    }

    fn file_name(&self, peer_id: &str) -> OsString {
        let mut file_name = OsString::from(URL_SAFE_NO_PAD.encode(peer_id));
        file_name.push(".json");
        file_name
    }

    fn write_atomic(&self, path: &Path, payload: &[u8]) -> Result<(), RegistryError> {
        let parent = path.parent().unwrap_or(&self.root);
        fs::create_dir_all(parent)?;

        let temp_path = self.temp_path(parent, path);
        let result = (|| -> Result<(), RegistryError> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)?;
            file.write_all(payload)?;
            file.sync_all()?;
            fs::rename(&temp_path, path)?;
            Ok(())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }

        result
    }

    fn temp_path(&self, parent: &Path, path: &Path) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let mut temp_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("peer-registry")
            .to_owned();
        temp_name.push('.');
        temp_name.push_str(&process::id().to_string());
        temp_name.push('.');
        temp_name.push_str(&nanos.to_string());
        temp_name.push_str(".tmp");
        parent.join(temp_name)
    }

    fn pid_is_live(&self, pid: u32) -> bool {
        if pid == 0 {
            return false;
        }

        let pid = match i32::try_from(pid) {
            Ok(pid) => pid,
            Err(_) => return false,
        };

        #[cfg(unix)]
        {
            unsafe {
                let result = kill(pid, 0);
                if result == 0 {
                    true
                } else {
                    matches!(std::io::Error::last_os_error().raw_os_error(), Some(code) if code == 1)
                }
            }
        }

        #[cfg(not(unix))]
        {
            let _ = pid;
            false
        }
    }
}

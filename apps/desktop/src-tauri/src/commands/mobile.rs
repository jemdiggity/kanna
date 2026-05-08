use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;
use tokio::process::Command;
use tokio::sync::Mutex;

const LOCAL_SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_LOCAL_SERVER_PORT: u16 = 48_120;
const STATUS_POLL_ATTEMPTS: usize = 20;
const STATUS_POLL_DELAY_MS: u64 = 250;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MobileServerStatus {
    pub state: String,
    pub desktop_id: String,
    pub desktop_name: String,
    pub lan_host: String,
    pub lan_port: u16,
    pub pairing_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingSessionPayload {
    code: String,
}

#[derive(Clone)]
pub struct MobileServerManager {
    inner: Arc<Mutex<MobileServerState>>,
    server_lock: Arc<Mutex<Option<File>>>,
    client: reqwest::Client,
}

#[derive(Debug)]
struct MobileServerState {
    status: String,
    desktop_name: String,
    api_base_url: String,
    config_path: PathBuf,
    started: bool,
}

impl MobileServerManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let config_path = server_config_path_for_app_data_dir(&app_data_dir);
        Self {
            inner: Arc::new(Mutex::new(MobileServerState {
                status: "stopped".to_string(),
                desktop_name: default_desktop_name(),
                api_base_url: server_base_url(local_server_port()),
                config_path,
                started: false,
            })),
            server_lock: Arc::new(Mutex::new(None)),
            client: reqwest::Client::new(),
        }
    }

    pub async fn start(&self) -> Result<(), String> {
        let (config_path, desktop_name, api_base_url) = {
            let state = self.inner.lock().await;
            if state.started {
                return Ok(());
            }
            (
                state.config_path.clone(),
                state.desktop_name.clone(),
                state.api_base_url.clone(),
            )
        };

        let lock_path = server_lock_path_for_config(&config_path)?;
        let claimed_lock = match try_claim_server_lock(&lock_path) {
            Ok(lock) => lock,
            Err(err) => match self.fetch_status(&api_base_url).await {
                Ok(status) if status.desktop_id == desktop_id(&config_path) => {
                    let mut state = self.inner.lock().await;
                    state.started = true;
                    state.status = status.state;
                    state.desktop_name = status.desktop_name;
                    return Ok(());
                }
                Ok(status) => {
                    return Err(format!(
                        "kanna-server port is already owned by {} ({})",
                        status.desktop_name, status.desktop_id
                    ));
                }
                Err(_) => return Err(err),
            },
        };

        {
            let mut state = self.inner.lock().await;
            write_server_config(&state)?;
            state.started = true;
        }
        *self.server_lock.lock().await = Some(claimed_lock);

        let server_bin = match find_sidecar("kanna-server") {
            Ok(path) => path,
            Err(err) => {
                let mut state = self.inner.lock().await;
                state.started = false;
                state.status = "error".to_string();
                *self.server_lock.lock().await = None;
                return Err(err);
            }
        };

        let mut child = match Command::new(server_bin)
            .env("KANNA_SERVER_CONFIG", &config_path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                let mut state = self.inner.lock().await;
                state.started = false;
                state.status = "error".to_string();
                *self.server_lock.lock().await = None;
                return Err(format!("failed to spawn kanna-server: {}", err));
            }
        };

        let status = match self.wait_for_status(&api_base_url).await {
            Ok(status) => status,
            Err(err) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                let mut state = self.inner.lock().await;
                state.started = false;
                state.status = "error".to_string();
                *self.server_lock.lock().await = None;
                return Err(err);
            }
        };

        {
            let mut state = self.inner.lock().await;
            state.status = status.state.clone();
            state.desktop_name = status.desktop_name.clone();
        }

        let state_handle = self.inner.clone();
        let lock_handle = self.server_lock.clone();
        tauri::async_runtime::spawn(async move {
            let exit = child.wait().await;
            let mut state = state_handle.lock().await;
            state.started = false;
            state.desktop_name = desktop_name;
            *lock_handle.lock().await = None;
            match exit {
                Ok(status) if status.success() => {
                    state.status = "stopped".to_string();
                }
                Ok(status) => {
                    state.status = "error".to_string();
                    eprintln!("[mobile] kanna-server exited with {}", status);
                }
                Err(err) => {
                    state.status = "error".to_string();
                    eprintln!("[mobile] failed to wait for kanna-server: {}", err);
                }
            }
        });

        Ok(())
    }

    pub async fn snapshot(&self) -> Result<MobileServerStatus, String> {
        let state = self.inner.lock().await;
        if !state.started {
            return Ok(stopped_snapshot(&state));
        }
        let api_base_url = state.api_base_url.clone();
        drop(state);

        let status = self.fetch_status(&api_base_url).await?;
        let mut state = self.inner.lock().await;
        state.status = status.state.clone();
        state.desktop_name = status.desktop_name.clone();
        Ok(status)
    }

    pub async fn create_pairing_session(&self) -> Result<MobileServerStatus, String> {
        let api_base_url = {
            let state = self.inner.lock().await;
            if !state.started {
                return Err("kanna-server is not running".to_string());
            }
            state.api_base_url.clone()
        };

        let response = self
            .client
            .post(format!("{}/v1/pairing/sessions", api_base_url))
            .send()
            .await
            .map_err(|e| format!("failed to create pairing session: {}", e))?;
        let response = response
            .error_for_status()
            .map_err(|e| format!("pairing session request failed: {}", e))?;
        let pairing = response
            .json::<PairingSessionPayload>()
            .await
            .map_err(|e| format!("failed to parse pairing session response: {}", e))?;

        if pairing.code.is_empty() {
            return Err("kanna-server returned an empty pairing code".to_string());
        }

        self.snapshot().await
    }

    async fn wait_for_status(&self, api_base_url: &str) -> Result<MobileServerStatus, String> {
        let mut last_error = "kanna-server did not become ready".to_string();
        for _ in 0..STATUS_POLL_ATTEMPTS {
            match self.fetch_status(api_base_url).await {
                Ok(status) => return Ok(status),
                Err(err) => {
                    last_error = err;
                    tokio::time::sleep(std::time::Duration::from_millis(STATUS_POLL_DELAY_MS))
                        .await;
                }
            }
        }

        Err(last_error)
    }

    async fn fetch_status(&self, api_base_url: &str) -> Result<MobileServerStatus, String> {
        let response = self
            .client
            .get(format!("{}/v1/status", api_base_url))
            .send()
            .await
            .map_err(|e| format!("failed to fetch mobile server status: {}", e))?;
        let response = response
            .error_for_status()
            .map_err(|e| format!("mobile server status request failed: {}", e))?;
        response
            .json::<MobileServerStatus>()
            .await
            .map_err(|e| format!("failed to decode mobile server status: {}", e))
    }
}

#[tauri::command]
pub async fn mobile_server_status(app: tauri::AppHandle) -> Result<MobileServerStatus, String> {
    let manager = app.state::<MobileServerManager>();
    manager.snapshot().await
}

#[tauri::command]
pub async fn create_mobile_pairing_session(
    app: tauri::AppHandle,
) -> Result<MobileServerStatus, String> {
    let manager = app.state::<MobileServerManager>();
    manager.create_pairing_session().await
}

fn write_server_config(state: &MobileServerState) -> Result<(), String> {
    let config = build_server_config(state)?;
    if let Some(parent) = state.config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create mobile config dir: {}", e))?;
    }
    std::fs::write(&state.config_path, config)
        .map_err(|e| format!("failed to write mobile server config: {}", e))
}

fn server_config_path_for_app_data_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("Kanna")
        .join("servers")
        .join(server_config_scope())
        .join("server.toml")
}

fn server_config_scope() -> String {
    if let Ok(db_name) = std::env::var("KANNA_DB_NAME") {
        return sanitize_server_scope(
            Path::new(&db_name)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or(&db_name),
        );
    }

    if let Ok(db_path) = std::env::var("KANNA_DB_PATH") {
        let path = Path::new(&db_path);
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("custom-db");
        return format!("{}-{:08x}", sanitize_server_scope(stem), path_hash(path));
    }

    "kanna-v2".to_string()
}

fn sanitize_server_scope(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "database".to_string()
    } else {
        sanitized
    }
}

fn path_hash(path: &Path) -> u32 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    hasher.finish() as u32
}

fn server_lock_path_for_config(config_path: &Path) -> Result<PathBuf, String> {
    let dir = config_path
        .parent()
        .ok_or_else(|| "mobile config path missing parent directory".to_string())?;
    Ok(dir.join("server.lock"))
}

fn try_claim_server_lock(lock_path: &Path) -> Result<File, String> {
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create mobile server lock dir: {}", e))?;
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(lock_path)
        .map_err(|e| format!("failed to open mobile server lock: {}", e))?;
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc == 0 {
        Ok(file)
    } else {
        Err(format!(
            "another kanna-server is already starting for {}",
            lock_path.display()
        ))
    }
}

fn build_server_config(state: &MobileServerState) -> Result<String, String> {
    let daemon_dir = std::env::var("KANNA_DAEMON_DIR")
        .unwrap_or_else(|_| crate::daemon_data_dir().to_string_lossy().to_string());
    let db_path = resolved_db_path(state)?;
    let pairing_store_path = state
        .config_path
        .parent()
        .ok_or_else(|| "mobile config path missing parent directory".to_string())?
        .join("mobile-pairings.json");
    let device_token = generate_device_token()?;

    Ok(format!(
        "relay_url = \"wss://kanna-relay.run.app\"\ndevice_token = \"{}\"\ndaemon_dir = \"{}\"\ndb_path = \"{}\"\ndesktop_id = \"{}\"\ndesktop_name = \"{}\"\nlan_host = \"0.0.0.0\"\nlan_port = {}\npairing_store_path = \"{}\"\n",
        escape_toml_string(&device_token),
        escape_toml_string(&daemon_dir),
        escape_toml_string(&db_path.to_string_lossy()),
        escape_toml_string(&desktop_id(&state.config_path)),
        escape_toml_string(&state.desktop_name),
        local_server_port(),
        escape_toml_string(&pairing_store_path.to_string_lossy()),
    ))
}

fn resolved_db_path(state: &MobileServerState) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("KANNA_DB_PATH") {
        return Ok(PathBuf::from(path));
    }

    let app_data_dir = app_data_dir_for_server_config(&state.config_path)?;
    if let Ok(db_name) = std::env::var("KANNA_DB_NAME") {
        return Ok(app_data_dir.join(db_name));
    }

    Ok(app_data_dir.join("kanna-v2.db"))
}

fn app_data_dir_for_server_config(config_path: &Path) -> Result<PathBuf, String> {
    let config_dir = config_path
        .parent()
        .ok_or_else(|| "mobile config path missing parent directory".to_string())?;

    if config_dir.file_name().and_then(|value| value.to_str()) == Some("Kanna") {
        return config_dir
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "mobile config path missing app data directory".to_string());
    }

    if config_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|value| value.to_str())
        == Some("servers")
    {
        return config_dir
            .parent()
            .and_then(|servers_dir| servers_dir.parent())
            .and_then(|kanna_dir| kanna_dir.parent())
            .map(Path::to_path_buf)
            .ok_or_else(|| "mobile server config path missing app data directory".to_string());
    }

    config_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "mobile config path missing app data directory".to_string())
}

fn local_server_port() -> u16 {
    std::env::var("KANNA_MOBILE_SERVER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_LOCAL_SERVER_PORT)
}

fn find_sidecar(name: &str) -> Result<PathBuf, String> {
    for candidate in crate::commands::fs::sidecar_candidates(name) {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!("mobile sidecar '{}' not found", name))
}

fn server_base_url(port: u16) -> String {
    format!("http://{}:{}", LOCAL_SERVER_HOST, port)
}

fn stopped_snapshot(state: &MobileServerState) -> MobileServerStatus {
    MobileServerStatus {
        state: state.status.clone(),
        desktop_id: desktop_id(&state.config_path),
        desktop_name: state.desktop_name.clone(),
        lan_host: "0.0.0.0".to_string(),
        lan_port: local_server_port(),
        pairing_code: None,
    }
}

fn desktop_id(config_path: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    config_path.hash(&mut hasher);
    format!("desktop-{:08x}", hasher.finish() as u32)
}

fn generate_device_token() -> Result<String, String> {
    use std::fs::File;
    use std::io::Read;

    let mut bytes = [0u8; 16];
    File::open("/dev/urandom")
        .map_err(|e| format!("failed to open /dev/urandom: {}", e))?
        .read_exact(&mut bytes)
        .map_err(|e| format!("failed to read random bytes: {}", e))?;
    Ok(bytes.iter().map(|b| format!("{:02x}", b)).collect())
}

fn default_desktop_name() -> String {
    std::env::var("HOSTNAME").unwrap_or_else(|_| "Kanna Desktop".to_string())
}

fn escape_toml_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::{
        app_data_dir_for_server_config, build_server_config, desktop_id, escape_toml_string,
        resolved_db_path, server_base_url, server_config_path_for_app_data_dir,
        server_lock_path_for_config, stopped_snapshot, try_claim_server_lock, MobileServerManager,
        MobileServerState,
    };
    use std::ffi::CString;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    unsafe fn set_env_var(key: &str, value: &str) {
        let key = CString::new(key).expect("env key should be valid");
        let value = CString::new(value).expect("env value should be valid");
        assert_eq!(libc::setenv(key.as_ptr(), value.as_ptr(), 1), 0);
    }

    unsafe fn unset_env_var(key: &str) {
        let key = CString::new(key).expect("env key should be valid");
        assert_eq!(libc::unsetenv(key.as_ptr()), 0);
    }

    #[test]
    fn escape_toml_string_escapes_quotes_and_backslashes() {
        assert_eq!(escape_toml_string(r#"foo\bar"baz"#), r#"foo\\bar\"baz"#);
    }

    #[test]
    fn desktop_id_is_stable_for_the_same_path() {
        let path = std::path::Path::new("/tmp/kanna/server.toml");
        assert_eq!(desktop_id(path), desktop_id(path));
    }

    #[test]
    fn server_base_url_uses_loopback() {
        assert_eq!(server_base_url(48120), "http://127.0.0.1:48120");
    }

    #[test]
    fn manager_uses_database_scoped_config_path_to_avoid_worktree_clobbering() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");
        unsafe {
            set_env_var("KANNA_DB_NAME", "kanna-wt-task-1234.db");
        }

        let manager = MobileServerManager::new(PathBuf::from("/tmp/build.kanna"));
        let state = manager.inner.blocking_lock();
        let config_path = state.config_path.clone();

        unsafe {
            unset_env_var("KANNA_DB_NAME");
        }

        assert_eq!(
            config_path,
            PathBuf::from("/tmp/build.kanna/Kanna/servers/kanna-wt-task-1234/server.toml")
        );
    }

    #[test]
    fn default_config_path_remains_production_database_scoped() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");
        unsafe {
            unset_env_var("KANNA_DB_NAME");
            unset_env_var("KANNA_DB_PATH");
        }

        assert_eq!(
            server_config_path_for_app_data_dir(&PathBuf::from("/tmp/build.kanna")),
            PathBuf::from("/tmp/build.kanna/Kanna/servers/kanna-v2/server.toml")
        );
    }

    #[test]
    fn server_lock_prevents_duplicate_owner_for_same_database_config() {
        let root = std::env::temp_dir().join(format!(
            "kanna-mobile-lock-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let config_path = root.join("Kanna/servers/kanna-v2/server.toml");
        let lock_path = server_lock_path_for_config(&config_path).unwrap();

        let first = try_claim_server_lock(&lock_path).expect("first lock should succeed");
        let second = try_claim_server_lock(&lock_path);

        assert!(second.is_err(), "second owner unexpectedly claimed lock");

        drop(first);
        let third = try_claim_server_lock(&lock_path).expect("lock should release on drop");
        drop(third);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolved_db_path_defaults_to_app_data_dir() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");
        unsafe {
            unset_env_var("KANNA_DB_NAME");
            unset_env_var("KANNA_DB_PATH");
        }

        let state = MobileServerState {
            status: "stopped".to_string(),
            desktop_name: "Studio Mac".to_string(),
            api_base_url: server_base_url(48120),
            config_path: PathBuf::from("/tmp/build.kanna/Kanna/servers/kanna-v2/server.toml"),
            started: false,
        };

        assert_eq!(
            resolved_db_path(&state).unwrap(),
            PathBuf::from("/tmp/build.kanna/kanna-v2.db")
        );
    }

    #[test]
    fn resolved_db_path_uses_kanna_db_name_inside_app_data_dir() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");
        unsafe {
            set_env_var("KANNA_DB_NAME", "kanna-wt-task-1234.db");
        }

        let state = MobileServerState {
            status: "stopped".to_string(),
            desktop_name: "Studio Mac".to_string(),
            api_base_url: server_base_url(48120),
            config_path: PathBuf::from(
                "/tmp/build.kanna/Kanna/servers/kanna-wt-task-1234/server.toml",
            ),
            started: false,
        };

        let resolved = resolved_db_path(&state).unwrap();

        unsafe {
            unset_env_var("KANNA_DB_NAME");
        }

        assert_eq!(
            resolved,
            PathBuf::from("/tmp/build.kanna/kanna-wt-task-1234.db")
        );
    }

    #[test]
    fn app_data_dir_resolution_supports_legacy_and_scoped_config_paths() {
        assert_eq!(
            app_data_dir_for_server_config(&PathBuf::from("/tmp/build.kanna/Kanna/server.toml"))
                .unwrap(),
            PathBuf::from("/tmp/build.kanna")
        );
        assert_eq!(
            app_data_dir_for_server_config(&PathBuf::from(
                "/tmp/build.kanna/Kanna/servers/kanna-v2/server.toml"
            ))
            .unwrap(),
            PathBuf::from("/tmp/build.kanna")
        );
    }

    #[test]
    fn build_server_config_includes_desktop_identity_and_db_path() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");
        unsafe {
            unset_env_var("KANNA_MOBILE_SERVER_PORT");
            unset_env_var("KANNA_DB_NAME");
            unset_env_var("KANNA_DB_PATH");
        }

        let state = MobileServerState {
            status: "stopped".to_string(),
            desktop_name: "Studio Mac".to_string(),
            api_base_url: server_base_url(48120),
            config_path: PathBuf::from("/tmp/build.kanna/Kanna/servers/kanna-v2/server.toml"),
            started: false,
        };

        let config = build_server_config(&state).unwrap();
        assert!(config.contains("desktop_name = \"Studio Mac\""));
        assert!(config.contains("db_path = \"/tmp/build.kanna/kanna-v2.db\""));
        assert!(config.contains("lan_port = 48120"));
    }

    #[test]
    fn build_server_config_uses_overridden_mobile_server_port() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");
        unsafe {
            set_env_var("KANNA_MOBILE_SERVER_PORT", "48129");
        }

        let state = MobileServerState {
            status: "stopped".to_string(),
            desktop_name: "Studio Mac".to_string(),
            api_base_url: server_base_url(48120),
            config_path: PathBuf::from("/tmp/build.kanna/Kanna/server.toml"),
            started: false,
        };

        let config = build_server_config(&state).unwrap();

        unsafe {
            unset_env_var("KANNA_MOBILE_SERVER_PORT");
        }

        assert!(config.contains("lan_port = 48129"));
    }

    #[test]
    fn stopped_snapshot_reflects_local_state() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");
        unsafe {
            unset_env_var("KANNA_MOBILE_SERVER_PORT");
        }

        let state = MobileServerState {
            status: "stopped".to_string(),
            desktop_name: "Studio Mac".to_string(),
            api_base_url: server_base_url(48120),
            config_path: PathBuf::from("/tmp/build.kanna/Kanna/server.toml"),
            started: false,
        };

        let snapshot = stopped_snapshot(&state);
        assert_eq!(snapshot.state, "stopped");
        assert_eq!(snapshot.desktop_name, "Studio Mac");
        assert_eq!(snapshot.lan_port, 48120);
        assert!(snapshot.pairing_code.is_none());
    }
}

use serde::Deserialize;
use std::path::PathBuf;

const DESKTOP_BUNDLE_IDENTIFIER: &str = "build.kanna";
const LEGACY_DESKTOP_BUNDLE_IDENTIFIER: &str = "com.kanna.app";

#[derive(Debug, Deserialize)]
pub struct Config {
    pub relay_url: String,
    pub device_token: String,
    #[serde(default = "default_daemon_dir")]
    pub daemon_dir: String,
    #[serde(default = "default_db_path")]
    pub db_path: String,
}

fn default_daemon_dir() -> String {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Kanna")
        .to_string_lossy()
        .to_string()
}

fn app_data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn canonical_db_path() -> PathBuf {
    app_data_dir()
        .join(DESKTOP_BUNDLE_IDENTIFIER)
        .join("kanna-v2.db")
}

fn legacy_db_path() -> PathBuf {
    app_data_dir()
        .join(LEGACY_DESKTOP_BUNDLE_IDENTIFIER)
        .join("kanna-v2.db")
}

fn preferred_db_path() -> PathBuf {
    let canonical = canonical_db_path();
    if canonical.exists() {
        return canonical;
    }

    let legacy = legacy_db_path();
    if legacy.exists() {
        return legacy;
    }

    canonical
}

pub fn default_db_path() -> String {
    preferred_db_path().to_string_lossy().to_string()
}

fn normalize_db_path(path: &str) -> String {
    let configured = PathBuf::from(path);
    let canonical = canonical_db_path();
    let legacy = legacy_db_path();
    if configured == canonical || configured == legacy {
        return preferred_db_path().to_string_lossy().to_string();
    }

    path.to_string()
}

impl Config {
    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let config_path = match std::env::var("KANNA_SERVER_CONFIG") {
            Ok(p) => PathBuf::from(p),
            Err(_) => dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("Kanna")
                .join("server.toml"),
        };
        let content = std::fs::read_to_string(&config_path).map_err(|e| {
            format!(
                "Failed to read {}: {}. Run 'kanna-server register' first.",
                config_path.display(),
                e
            )
        })?;
        let mut config: Config = toml::from_str(&content)?;
        config.db_path = normalize_db_path(&config.db_path);
        Ok(config)
    }
}

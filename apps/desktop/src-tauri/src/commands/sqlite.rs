use rusqlite::{Connection, OpenFlags};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

const SQLITE_BUSY_TIMEOUT_MS: u64 = 10_000;

#[tauri::command]
pub fn backup_sqlite_database(app: tauri::AppHandle, db_name: String) -> Result<String, String> {
    if !is_plain_database_filename(&db_name) {
        return Err("database name must be a plain filename".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {}", e))?;
    let db_path = app_data_dir.join(db_name);
    let backup_path = backup_path_for_database(&db_path)?;
    backup_sqlite_database_path(&db_path, &backup_path)?;
    Ok(backup_path.to_string_lossy().to_string())
}

fn is_plain_database_filename(db_name: &str) -> bool {
    let mut components = Path::new(db_name).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

fn backup_path_for_database(db_path: &Path) -> Result<PathBuf, String> {
    let file_name = db_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "database path missing filename".to_string())?;
    let timestamp = backup_timestamp();
    let first = db_path.with_file_name(format!("{file_name}.backup-{timestamp}"));
    if !first.exists() {
        return Ok(first);
    }

    for suffix in 1..100 {
        let candidate = db_path.with_file_name(format!("{file_name}.backup-{timestamp}-{suffix}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("failed to choose a unique backup path".to_string())
}

fn backup_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string()
}

fn backup_sqlite_database_path(db_path: &Path, backup_path: &Path) -> Result<(), String> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
    )
    .map_err(|e| format!("failed to open database for backup: {}", e))?;
    conn.busy_timeout(Duration::from_millis(SQLITE_BUSY_TIMEOUT_MS))
        .map_err(|e| format!("failed to set backup busy timeout: {}", e))?;
    run_quick_check(&conn)
        .map_err(|e| format!("database health check failed before backup: {}", e))?;

    let backup_path_string = backup_path.to_string_lossy().to_string();
    conn.execute("VACUUM main INTO ?1", [&backup_path_string])
        .map_err(|e| format!("failed to create SQLite backup: {}", e))?;
    Ok(())
}

fn run_quick_check(conn: &Connection) -> Result<(), String> {
    let result: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if result == "ok" {
        Ok(())
    } else {
        Err(result)
    }
}

#[cfg(test)]
mod tests {
    use super::{backup_sqlite_database_path, is_plain_database_filename};
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "kanna-sqlite-backup-{name}-{}-{}.sqlite",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn backup_sqlite_database_path_creates_consistent_snapshot() {
        let db_path = temp_path("source");
        let backup_path = temp_path("backup");
        let conn = Connection::open(&db_path).expect("open source db");
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
            INSERT INTO item (name) VALUES ('alpha'), ('beta');
            "#,
        )
        .expect("seed source db");
        backup_sqlite_database_path(&db_path, &backup_path).expect("create backup");

        let backup = Connection::open(&backup_path).expect("open backup");
        let count: i64 = backup
            .query_row("SELECT COUNT(*) FROM item", [], |row| row.get(0))
            .expect("count backup rows");
        let quick_check: String = backup
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .expect("quick check");

        assert_eq!(count, 2);
        assert_eq!(quick_check, "ok");

        drop(conn);
        let _ = std::fs::remove_file(db_path);
        let _ = std::fs::remove_file(backup_path);
    }

    #[test]
    fn database_backup_command_accepts_only_plain_filenames() {
        assert!(is_plain_database_filename("kanna-v2.db"));
        assert!(!is_plain_database_filename("../kanna-v2.db"));
        assert!(!is_plain_database_filename("nested/kanna-v2.db"));
        assert!(!is_plain_database_filename(".."));
        assert!(!is_plain_database_filename(""));
    }
}

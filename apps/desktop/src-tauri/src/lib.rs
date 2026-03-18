mod commands;
mod daemon_client;

use commands::agent::AgentState;
use commands::daemon::DaemonState;
use daemon_client::DaemonClient;
use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

fn daemon_socket_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Kanna")
        .join("daemon.sock")
}

/// Try to connect to the daemon. Returns None if not available.
async fn try_connect_daemon() -> Option<DaemonClient> {
    let socket_path = daemon_socket_path();
    DaemonClient::connect(&socket_path).await.ok()
}

/// Spawn the event bridge: a background task that reads events from a dedicated
/// daemon connection and emits them as Tauri events.
fn spawn_event_bridge(app: tauri::AppHandle) {
    tokio::spawn(async move {
        // Try to connect a dedicated event connection
        let mut event_client = match try_connect_daemon().await {
            Some(c) => c,
            None => {
                eprintln!("[event-bridge] daemon not available, skipping event bridge");
                return;
            }
        };

        eprintln!("[event-bridge] connected to daemon for event streaming");

        loop {
            match event_client.read_event().await {
                Ok(line) => {
                    let event: serde_json::Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    match event.get("type").and_then(|t| t.as_str()) {
                        Some("Output") => {
                            let _ = app.emit("terminal_output", &event);
                        }
                        Some("Exit") => {
                            let _ = app.emit("session_exit", &event);
                        }
                        Some("HookEvent") => {
                            let _ = app.emit("hook_event", &event);
                        }
                        Some("StatusChanged") => {
                            let _ = app.emit("status_changed", &event);
                        }
                        _ => {}
                    }
                }
                Err(_) => {
                    eprintln!("[event-bridge] daemon connection lost");
                    break;
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_delta_updater::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_webdriver::init());
    }

    builder
        .manage(Arc::new(DashMap::new()) as AgentState)
        .manage(Arc::new(Mutex::new(None)) as DaemonState)
        .setup(|app| {
            // Start the event bridge if the daemon is running
            let handle = app.handle().clone();
            tokio::spawn(async move {
                // Give the daemon a moment to be ready (app may have just started it)
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                spawn_event_bridge(handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Agent commands
            commands::agent::create_agent_session,
            commands::agent::agent_next_message,
            commands::agent::agent_send_message,
            commands::agent::agent_interrupt,
            commands::agent::agent_close_session,
            // Daemon commands
            commands::daemon::spawn_session,
            commands::daemon::send_input,
            commands::daemon::resize_session,
            commands::daemon::signal_session,
            commands::daemon::kill_session,
            commands::daemon::list_sessions,
            commands::daemon::attach_session,
            commands::daemon::detach_session,
            // Git commands
            commands::git::git_diff,
            commands::git::git_worktree_list,
            commands::git::git_log,
            commands::git::git_default_branch,
            commands::git::git_remote_url,
            commands::git::git_push,
            commands::git::git_worktree_add,
            commands::git::git_worktree_remove,
            // FS commands
            commands::fs::file_exists,
            commands::fs::read_text_file,
            commands::fs::which_binary,
            commands::fs::read_env_var,
            commands::fs::append_log,
            // Shell commands
            commands::shell::run_script,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

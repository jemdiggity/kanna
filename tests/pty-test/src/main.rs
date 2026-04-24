//! Minimal PTY test — spawn Claude via the daemon, dump raw output to stdout.
//! This bypasses the entire Tauri/Vue/xterm.js stack to verify the daemon
//! produces correct terminal bytes.
//!
//! Usage:
//!   1. Start the daemon: cd crates/daemon && cargo run
//!   2. Run this test: cd tests/pty-test && cargo run
//!
//! You should see Claude's interactive terminal output in your real terminal.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;

fn main() {
    let socket_path = format!(
        "{}/Library/Application Support/Kanna/daemon.sock",
        std::env::var("HOME").unwrap()
    );

    eprintln!("[pty-test] Connecting to daemon at {}", socket_path);

    // Connection 1: Spawn
    let mut spawn_conn = UnixStream::connect(&socket_path).expect("Failed to connect to daemon");
    let session_id = format!("pty-test-{}", std::process::id());

    let spawn_cmd = serde_json::json!({
        "type": "Spawn",
        "session_id": session_id,
        "executable": "/bin/zsh",
        "args": ["--login", "-c", "claude --dangerously-skip-permissions 'say hello world briefly'"],
        "cwd": "/tmp",
        "env": {"TERM": "xterm-256color"},
        "cols": 80,
        "rows": 24,
    });

    let mut msg = serde_json::to_string(&spawn_cmd).unwrap();
    msg.push('\n');
    spawn_conn.write_all(msg.as_bytes()).unwrap();

    let mut reader = BufReader::new(&spawn_conn);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    eprintln!("[pty-test] Spawn response: {}", line.trim());

    // Connection 2: AttachSnapshot
    let attach_conn = UnixStream::connect(&socket_path).expect("Failed to connect for attach");
    let mut attach_writer = attach_conn.try_clone().unwrap();

    let attach_cmd = serde_json::json!({
        "type": "AttachSnapshot",
        "session_id": session_id,
    });
    let mut msg = serde_json::to_string(&attach_cmd).unwrap();
    msg.push('\n');
    attach_writer.write_all(msg.as_bytes()).unwrap();

    let mut attach_reader = BufReader::new(&attach_conn);

    // Read Snapshot response
    let mut line = String::new();
    attach_reader.read_line(&mut line).unwrap();
    eprintln!("[pty-test] AttachSnapshot response: {}", line.trim());

    // Stream output — parse JSON, extract data bytes, write to stdout
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();

    loop {
        let mut line = String::new();
        match attach_reader.read_line(&mut line) {
            Ok(0) => break, // EOF
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(event) => {
                        match event.get("type").and_then(|t| t.as_str()) {
                            Some("Output") => {
                                if let Some(data) = event.get("data").and_then(|d| d.as_array()) {
                                    let bytes: Vec<u8> = data
                                        .iter()
                                        .filter_map(|v| v.as_u64().map(|n| n as u8))
                                        .collect();
                                    stdout.write_all(&bytes).unwrap();
                                    stdout.flush().unwrap();
                                }
                            }
                            Some("Exit") => {
                                let code = event.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
                                eprintln!("\n[pty-test] Process exited with code {}", code);
                                break;
                            }
                            other => {
                                eprintln!("[pty-test] Event: {:?}", other);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[pty-test] Parse error: {} — line: {}", e, trimmed);
                    }
                }
            }
            Err(e) => {
                eprintln!("[pty-test] Read error: {}", e);
                break;
            }
        }
    }
}

//! Integration tests for daemon handoff (session transfer on upgrade).
//!
//! These tests spawn real daemon processes and verify that:
//!   - New daemon takes over sessions from old daemon
//!   - Child processes survive the transfer
//!   - I/O works through the new daemon after handoff
//!   - Handoff with no active sessions works
//!   - Old daemon exits after handoff

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---- Protocol types ----

#[allow(dead_code)]
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum Cmd {
    Spawn {
        session_id: String,
        executable: String,
        args: Vec<String>,
        cwd: String,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
    },
    Attach {
        session_id: String,
    },
    Input {
        session_id: String,
        data: Vec<u8>,
    },
    List,
    Subscribe,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum Evt {
    Output {
        session_id: String,
        data: Vec<u8>,
    },
    Exit {
        session_id: String,
        code: i32,
    },
    SessionCreated {
        session_id: String,
    },
    SessionList {
        sessions: Vec<Value>,
    },
    Ok,
    Error {
        message: String,
    },
    ShuttingDown,
    #[serde(other)]
    Unknown,
}

// ---- Test harness ----

/// Compute the socket path using the same hash the daemon uses.
fn compute_socket_path(dir: &PathBuf) -> PathBuf {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    dir.hash(&mut hasher);
    let hash = hasher.finish() as u32;
    PathBuf::from(format!("/tmp/kanna-{:08x}.sock", hash))
}

struct DaemonHandle {
    child: Child,
    socket_path: PathBuf,
}

impl DaemonHandle {
    /// Start a daemon in the given directory. If a daemon is already running
    /// there (from a previous start), the new one will attempt handoff.
    fn start_in(dir: &PathBuf) -> Self {
        std::fs::create_dir_all(dir).unwrap();

        let daemon_bin = PathBuf::from(env!("CARGO_BIN_EXE_kanna-daemon"));
        let socket_path = compute_socket_path(dir);
        let pid_path = dir.join("daemon.pid");

        let child = Command::new(&daemon_bin)
            .env("KANNA_DAEMON_DIR", dir.to_str().unwrap())
            .spawn()
            .expect("failed to start daemon");

        let expected_pid = child.id();

        // Wait for this specific daemon to be ready (PID file matches + socket works)
        for _ in 0..100 {
            if let Ok(pid_str) = std::fs::read_to_string(&pid_path) {
                if let Ok(pid) = pid_str.trim().parse::<u32>() {
                    if pid == expected_pid && UnixStream::connect(&socket_path).is_ok() {
                        break;
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        // Verify our daemon is running
        let actual_pid = std::fs::read_to_string(&pid_path)
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);
        assert_eq!(actual_pid, expected_pid, "PID file should match our daemon");

        DaemonHandle { child, socket_path }
    }

    fn connect(&self) -> ClientConn {
        let stream = UnixStream::connect(&self.socket_path).expect("failed to connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        ClientConn {
            reader: BufReader::new(stream.try_clone().unwrap()),
            writer: stream,
        }
    }
}

impl Drop for DaemonHandle {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct ClientConn {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
}

impl ClientConn {
    fn send(&mut self, cmd: &Cmd) {
        let mut json = serde_json::to_string(cmd).unwrap();
        json.push('\n');
        self.writer.write_all(json.as_bytes()).unwrap();
        self.writer.flush().unwrap();
    }

    fn recv(&mut self) -> Evt {
        let mut line = String::new();
        self.reader.read_line(&mut line).expect("read timed out");
        serde_json::from_str(line.trim())
            .unwrap_or_else(|e| panic!("failed to parse: {} — {:?}", e, line.trim()))
    }

    fn collect_output(&mut self, n: usize) -> Vec<u8> {
        let mut collected = Vec::new();
        while collected.len() < n {
            match self.recv() {
                Evt::Output { data, .. } => collected.extend_from_slice(&data),
                Evt::Exit { .. } => break,
                _ => {}
            }
        }
        collected
    }

    fn drain_output(&mut self, timeout: Duration) -> Vec<u8> {
        self.writer.set_read_timeout(Some(timeout)).unwrap();
        let mut collected = Vec::new();
        loop {
            let mut line = String::new();
            match self.reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    if let Ok(Evt::Output { data, .. }) = serde_json::from_str(line.trim()) {
                        collected.extend_from_slice(&data);
                    }
                }
                Err(_) => break,
            }
        }
        self.writer
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        collected
    }
}

fn spawn_echo(conn: &mut ClientConn, id: &str) {
    conn.send(&Cmd::Spawn {
        session_id: id.to_string(),
        executable: "/bin/cat".to_string(),
        args: vec![],
        cwd: "/tmp".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    });
    match conn.recv() {
        Evt::SessionCreated { .. } => {}
        other => panic!("expected SessionCreated, got: {:?}", other),
    }
}

fn attach(conn: &mut ClientConn, id: &str) {
    conn.send(&Cmd::Attach {
        session_id: id.to_string(),
    });
    match conn.recv() {
        Evt::Ok => {}
        Evt::Error { message } => panic!("attach failed: {}", message),
        other => panic!("expected Ok, got: {:?}", other),
    }
}

fn send_input(conn: &mut ClientConn, id: &str, data: &[u8]) {
    conn.send(&Cmd::Input {
        session_id: id.to_string(),
        data: data.to_vec(),
    });
    loop {
        match conn.recv() {
            Evt::Ok => break,
            Evt::Output { .. } => continue,
            Evt::Error { message } => panic!("input failed: {}", message),
            other => panic!("expected Ok, got: {:?}", other),
        }
    }
}

fn test_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "kanna-handoff-test-{}-{}",
        name,
        std::process::id()
    ))
}

fn cleanup(dir: &PathBuf) {
    let _ = std::fs::remove_dir_all(dir);
}

// ---- Tests ----

/// Handoff transfers a live session to the new daemon.
/// Child process (/bin/cat) survives and I/O works through daemon B.
#[test]
fn test_handoff_transfers_session() {
    let dir = test_dir("transfer");

    // Daemon A: spawn a session
    let daemon_a = DaemonHandle::start_in(&dir);
    let mut conn_a = daemon_a.connect();
    spawn_echo(&mut conn_a, "sess-handoff");
    attach(&mut conn_a, "sess-handoff");
    send_input(&mut conn_a, "sess-handoff", b"before\n");
    conn_a.drain_output(Duration::from_millis(500));

    // Daemon B: starts in same dir, triggers handoff from A
    drop(conn_a); // Close client connection to A
    let daemon_b = DaemonHandle::start_in(&dir);
    // start_in waits for B's PID in the PID file, so A is already gone

    // Connect to B and attach to the handed-off session
    let mut conn_b = daemon_b.connect();
    attach(&mut conn_b, "sess-handoff");

    // Send input — should work through daemon B
    send_input(&mut conn_b, "sess-handoff", b"after-handoff\n");
    let output = conn_b.collect_output(13);
    let output_str = String::from_utf8_lossy(&output);
    assert!(
        output_str.contains("after-handoff"),
        "I/O should work after handoff, got: {:?}",
        output_str
    );

    drop(daemon_b);
    cleanup(&dir);
}

/// Handoff with no active sessions — new daemon starts fresh.
#[test]
fn test_handoff_empty() {
    let dir = test_dir("empty");

    let _daemon_a = DaemonHandle::start_in(&dir);
    // Don't create any sessions

    // Daemon B: handoff with no sessions
    let daemon_b = DaemonHandle::start_in(&dir);

    // B should work for new sessions
    let mut conn = daemon_b.connect();
    spawn_echo(&mut conn, "fresh-session");
    attach(&mut conn, "fresh-session");
    send_input(&mut conn, "fresh-session", b"works\n");
    let output = conn.collect_output(5);
    assert!(
        String::from_utf8_lossy(&output).contains("works"),
        "fresh session should work after empty handoff"
    );

    drop(daemon_b);
    cleanup(&dir);
}

/// Multiple sessions survive handoff.
#[test]
fn test_handoff_multiple_sessions() {
    let dir = test_dir("multi");

    let daemon_a = DaemonHandle::start_in(&dir);
    let mut conn = daemon_a.connect();

    // Spawn 3 sessions
    for i in 0..3 {
        spawn_echo(&mut conn, &format!("sess-{}", i));
        let mut attach_conn = daemon_a.connect();
        attach(&mut attach_conn, &format!("sess-{}", i));
        send_input(
            &mut attach_conn,
            &format!("sess-{}", i),
            format!("init-{}\n", i).as_bytes(),
        );
        attach_conn.drain_output(Duration::from_millis(200));
    }

    drop(conn);

    // Daemon B
    let daemon_b = DaemonHandle::start_in(&dir);
    std::thread::sleep(Duration::from_millis(200));

    // Verify all 3 sessions work through B
    for i in 0..3 {
        let mut c = daemon_b.connect();
        attach(&mut c, &format!("sess-{}", i));
        send_input(
            &mut c,
            &format!("sess-{}", i),
            format!("via-b-{}\n", i).as_bytes(),
        );
        let output = c.collect_output(6);
        let s = String::from_utf8_lossy(&output);
        assert!(
            s.contains(&format!("via-b-{}", i)),
            "session {} should work after handoff, got: {:?}",
            i,
            s
        );
    }

    drop(daemon_b);
    cleanup(&dir);
}

/// Two subscribed clients both receive ShuttingDown when handoff is triggered.
#[test]
fn test_handoff_broadcasts_shutting_down() {
    let dir = test_dir("shutdown-broadcast");

    let daemon_a = DaemonHandle::start_in(&dir);

    // Two subscriber clients
    let mut sub_a = daemon_a.connect();
    sub_a.send(&Cmd::Subscribe);
    match sub_a.recv() {
        Evt::Ok => {}
        other => panic!("expected Ok, got {:?}", other),
    }

    let mut sub_b = daemon_a.connect();
    sub_b.send(&Cmd::Subscribe);
    match sub_b.recv() {
        Evt::Ok => {}
        other => panic!("expected Ok, got {:?}", other),
    }

    // Set read timeouts before handoff (sockets may close during handoff)
    sub_a
        .reader
        .get_ref()
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    sub_b
        .reader
        .get_ref()
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();

    // Trigger handoff by starting daemon B in same dir
    let _daemon_b = DaemonHandle::start_in(&dir);

    let evt_a = sub_a.recv();
    assert!(
        matches!(evt_a, Evt::ShuttingDown),
        "sub_a should get ShuttingDown, got: {:?}",
        evt_a
    );

    let evt_b = sub_b.recv();
    assert!(
        matches!(evt_b, Evt::ShuttingDown),
        "sub_b should get ShuttingDown, got: {:?}",
        evt_b
    );

    cleanup(&dir);
}

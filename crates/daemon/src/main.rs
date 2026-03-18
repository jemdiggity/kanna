mod fd_transfer;
mod protocol;
mod pty;
mod session;
mod socket;

use std::io::Read;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::io::BufReader;
use tokio::net::UnixStream;
use tokio::sync::{broadcast, Mutex};

/// Swappable writer target. stream_output checks this on every read.
/// None = no client attached (output discarded).
type ActiveWriter = Arc<Mutex<Option<Arc<Mutex<tokio::net::unix::OwnedWriteHalf>>>>>;

/// Map of session_id → active writer target.
type SessionWriters = Arc<Mutex<HashMap<String, ActiveWriter>>>;

use protocol::{Command, Event};
use session::SessionManager;
use socket::{bind_socket, read_command, write_event};

fn app_support_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("KANNA_DAEMON_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").expect("HOME not set");
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Kanna")
}

#[tokio::main]
async fn main() {
    let dir = app_support_dir();
    std::fs::create_dir_all(&dir).expect("Failed to create app support dir");

    let pid_path = dir.join("daemon.pid");
    let pid = std::process::id();
    std::fs::write(&pid_path, pid.to_string()).expect("Failed to write PID file");

    let socket_path = dir.join("daemon.sock");
    let listener = bind_socket(&socket_path).expect("Failed to bind Unix socket");

    eprintln!("kanna-daemon starting, pid={}, socket={:?}", pid, socket_path);

    let sessions: Arc<Mutex<SessionManager>> = Arc::new(Mutex::new(SessionManager::new()));
    let session_writers: SessionWriters = Arc::new(Mutex::new(HashMap::new()));

    let (hook_tx, _) = broadcast::channel::<String>(256);

    let pid_path_clone = pid_path.clone();
    let socket_path_clone = socket_path.clone();
    let sessions_shutdown = sessions.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        eprintln!("kanna-daemon shutting down");
        sessions_shutdown.lock().await.kill_all();
        let _ = std::fs::remove_file(&pid_path_clone);
        let _ = std::fs::remove_file(&socket_path_clone);
        std::process::exit(0);
    });

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let sessions_clone = sessions.clone();
                let hook_tx_clone = hook_tx.clone();
                let writers_clone = session_writers.clone();
                tokio::spawn(async move {
                    handle_connection(stream, sessions_clone, hook_tx_clone, writers_clone).await;
                });
            }
            Err(e) => {
                eprintln!("accept error: {}", e);
            }
        }
    }
}

async fn handle_connection(
    stream: UnixStream,
    sessions: Arc<Mutex<SessionManager>>,
    hook_tx: broadcast::Sender<String>,
    session_writers: SessionWriters,
) {
    let (read_half, write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let writer = Arc::new(Mutex::new(write_half));

    let subscribed = Arc::new(std::sync::atomic::AtomicBool::new(false));

    loop {
        let cmd = read_command(&mut reader).await;
        match cmd {
            None => break,
            Some(Command::Subscribe) => {
                if !subscribed.load(std::sync::atomic::Ordering::Relaxed) {
                    subscribed.store(true, std::sync::atomic::Ordering::Relaxed);
                    let mut hook_rx = hook_tx.subscribe();
                    let writer_hook = writer.clone();
                    tokio::spawn(async move {
                        use tokio::io::AsyncWriteExt;
                        while let Ok(msg) = hook_rx.recv().await {
                            let mut w = writer_hook.lock().await;
                            let _ = w.write_all(msg.as_bytes()).await;
                            let _ = w.write_all(b"\n").await;
                            let _ = w.flush().await;
                        }
                    });
                }
                let _ = write_event(&mut *writer.lock().await, &Event::Ok).await;
            }
            Some(command) => {
                handle_command(command, sessions.clone(), writer.clone(), &hook_tx, session_writers.clone()).await;
            }
        }
    }
}

async fn handle_command(
    command: Command,
    sessions: Arc<Mutex<SessionManager>>,
    writer: Arc<Mutex<tokio::net::unix::OwnedWriteHalf>>,
    hook_tx: &broadcast::Sender<String>,
    session_writers: SessionWriters,
) {
    match command {
        Command::Spawn {
            session_id,
            executable,
            args,
            cwd,
            env,
            cols,
            rows,
        } => {
            let mut mgr = sessions.lock().await;
            if mgr.contains(&session_id) {
                let evt = Event::Error {
                    message: format!("session already exists: {}", session_id),
                };
                let _ = write_event(&mut *writer.lock().await, &evt).await;
                return;
            }

            match pty::PtySession::spawn(&executable, &args, &cwd, &env, cols, rows) {
                Ok(pty_session) => {
                    mgr.insert(session_id.clone(), pty_session);
                    drop(mgr);

                    let evt = Event::SessionCreated {
                        session_id: session_id.clone(),
                    };
                    let _ = write_event(&mut *writer.lock().await, &evt).await;
                }
                Err(e) => {
                    let evt = Event::Error {
                        message: format!("failed to spawn PTY: {}", e),
                    };
                    let _ = write_event(&mut *writer.lock().await, &evt).await;
                }
            }
        }

        Command::Attach { session_id } => {
            let mgr = sessions.lock().await;
            if !mgr.contains(&session_id) {
                let evt = Event::Error {
                    message: format!("session not found: {}", session_id),
                };
                drop(mgr);
                let _ = write_event(&mut *writer.lock().await, &evt).await;
                return;
            }

            // First attach: clone reader and start the single stream_output task
            let is_first_attach = !session_writers.lock().await.contains_key(&session_id);
            if is_first_attach {
                let pty_reader = match mgr.sessions.get(&session_id).unwrap().try_clone_reader() {
                    Ok(r) => r,
                    Err(e) => {
                        let evt = Event::Error {
                            message: format!("failed to clone PTY reader: {}", e),
                        };
                        drop(mgr);
                        let _ = write_event(&mut *writer.lock().await, &evt).await;
                        return;
                    }
                };
                drop(mgr);

                let active_writer: ActiveWriter = Arc::new(Mutex::new(Some(writer.clone())));
                session_writers.lock().await.insert(session_id.clone(), active_writer.clone());

                let _ = write_event(&mut *writer.lock().await, &Event::Ok).await;

                let sid = session_id.clone();
                let sessions_exit = sessions.clone();
                let writers_cleanup = session_writers.clone();
                tokio::task::spawn_blocking(move || {
                    stream_output(sid, pty_reader, active_writer, sessions_exit, writers_cleanup);
                });
            } else {
                drop(mgr);

                // Reattach: just swap the writer target
                let writers = session_writers.lock().await;
                if let Some(active) = writers.get(&session_id) {
                    let mut w = active.lock().await;
                    *w = Some(writer.clone());
                }
                drop(writers);

                let _ = write_event(&mut *writer.lock().await, &Event::Ok).await;
            }
        }

        Command::Detach { session_id } => {
            let evt = if sessions.lock().await.contains(&session_id) {
                let writers = session_writers.lock().await;
                if let Some(active) = writers.get(&session_id) {
                    let mut w = active.lock().await;
                    *w = None;
                }
                Event::Ok
            } else {
                Event::Error {
                    message: format!("session not found: {}", session_id),
                }
            };
            let _ = write_event(&mut *writer.lock().await, &evt).await;
        }

        Command::Input { session_id, data } => {
            let mut mgr = sessions.lock().await;
            match mgr.get_mut(&session_id) {
                Some(session) => match session.write_input(&data) {
                    Ok(_) => {
                        drop(mgr);
                        let _ = write_event(&mut *writer.lock().await, &Event::Ok).await;
                    }
                    Err(e) => {
                        let evt = Event::Error {
                            message: format!("write error: {}", e),
                        };
                        drop(mgr);
                        let _ = write_event(&mut *writer.lock().await, &evt).await;
                    }
                },
                None => {
                    let evt = Event::Error {
                        message: format!("session not found: {}", session_id),
                    };
                    drop(mgr);
                    let _ = write_event(&mut *writer.lock().await, &evt).await;
                }
            }
        }

        Command::Resize { session_id, cols, rows } => {
            let mgr = sessions.lock().await;
            let result = mgr.resize(&session_id, cols, rows);
            drop(mgr);
            let evt = match result {
                Ok(_) => Event::Ok,
                Err(e) => Event::Error { message: e.to_string() },
            };
            let _ = write_event(&mut *writer.lock().await, &evt).await;
        }

        Command::Signal { session_id, signal } => {
            let sig = match signal.as_str() {
                "SIGTSTP" => libc::SIGTSTP,
                "SIGCONT" => libc::SIGCONT,
                "SIGTERM" => libc::SIGTERM,
                "SIGKILL" => libc::SIGKILL,
                other => {
                    let evt = Event::Error {
                        message: format!("unknown signal: {}", other),
                    };
                    let _ = write_event(&mut *writer.lock().await, &evt).await;
                    return;
                }
            };
            let mgr = sessions.lock().await;
            let result = mgr.signal(&session_id, sig);
            drop(mgr);
            let evt = match result {
                Ok(_) => Event::Ok,
                Err(e) => Event::Error { message: e.to_string() },
            };
            let _ = write_event(&mut *writer.lock().await, &evt).await;
        }

        Command::Kill { session_id } => {
            let mut mgr = sessions.lock().await;
            let result = match mgr.get_mut(&session_id) {
                Some(session) => session.kill(),
                None => Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("session not found: {}", session_id),
                )),
            };
            if result.is_ok() {
                mgr.remove(&session_id);
            }
            drop(mgr);
            session_writers.lock().await.remove(&session_id);
            let evt = match result {
                Ok(_) => Event::Ok,
                Err(e) => Event::Error { message: e.to_string() },
            };
            let _ = write_event(&mut *writer.lock().await, &evt).await;
        }

        Command::List => {
            let mut mgr = sessions.lock().await;
            let sessions_list = mgr.list();
            drop(mgr);
            let evt = Event::SessionList { sessions: sessions_list };
            let _ = write_event(&mut *writer.lock().await, &evt).await;
        }

        Command::Handoff => {
            let _ = write_event(&mut *writer.lock().await, &Event::HandoffUnsupported).await;
        }

        Command::Subscribe => {
            let _ = write_event(&mut *writer.lock().await, &Event::Ok).await;
        }

        Command::HookEvent { session_id, event, data } => {
            let evt = Event::HookEvent { session_id, event, data };
            if let Ok(json) = serde_json::to_string(&evt) {
                let _ = hook_tx.send(json);
            }
            let _ = write_event(&mut *writer.lock().await, &Event::Ok).await;
        }
    }
}

/// Runs in a blocking thread for the entire lifetime of a session.
/// ONE reader per session — never duplicated. Output is sent to whatever
/// client is currently attached via the swappable ActiveWriter.
fn stream_output(
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    active_writer: ActiveWriter,
    sessions: Arc<Mutex<SessionManager>>,
    session_writers: SessionWriters,
) {
    let rt = tokio::runtime::Handle::current();
    let mut buf = [0u8; 4096];

    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = buf[..n].to_vec();
                let evt = Event::Output {
                    session_id: session_id.clone(),
                    data,
                };
                rt.block_on(async {
                    let maybe_writer = active_writer.lock().await.clone();
                    if let Some(w) = maybe_writer {
                        let _ = write_event(&mut *w.lock().await, &evt).await;
                    }
                });
            }
            Err(e) => {
                eprintln!("PTY read error for session {}: {}", session_id, e);
                break;
            }
        }
    }

    let exit_code = {
        let mut mgr = rt.block_on(sessions.lock());
        let code = match mgr.get_mut(&session_id) {
            Some(session) => session.try_wait().unwrap_or(0),
            None => 0,
        };
        mgr.remove(&session_id);
        code
    };

    let evt = Event::Exit {
        session_id: session_id.clone(),
        code: exit_code,
    };
    rt.block_on(async {
        let maybe_writer = active_writer.lock().await.clone();
        if let Some(w) = maybe_writer {
            let _ = write_event(&mut *w.lock().await, &evt).await;
        }
        session_writers.lock().await.remove(&session_id);
    });
}

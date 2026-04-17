use crate::config::Config;
use crate::db::Db;
use crate::mobile_api::MobileApi;
use crate::pairing::{self, PairingSession};
use axum::extract::ws::{Message as WebSocketMessage, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use kanna_daemon::protocol::{Command as DaemonCommand, Event as DaemonEvent};
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct AppState {
    config: Config,
    pairing_session: Arc<Mutex<Option<PairingSession>>>,
    #[cfg(test)]
    task_creator: Option<TestTaskCreator>,
    #[cfg(test)]
    merge_agent_runner: Option<TestMergeAgentRunner>,
    #[cfg(test)]
    task_input_sender: Option<TestTaskInputSender>,
    #[cfg(test)]
    task_closer: Option<TestTaskCloser>,
    #[cfg(test)]
    stage_advancer: Option<TestStageAdvancer>,
    #[cfg(test)]
    task_terminal_streamer: Option<TestTaskTerminalStreamer>,
}

#[cfg(test)]
type TestTaskCreator = Arc<
    dyn Fn(
            crate::mobile_api::CreateTaskRequest,
        ) -> Result<crate::mobile_api::CreateTaskResponse, String>
        + Send
        + Sync,
>;

#[cfg(test)]
type TestMergeAgentRunner =
    Arc<dyn Fn(String) -> Result<crate::mobile_api::TaskActionResponse, String> + Send + Sync>;

#[cfg(test)]
type TestTaskInputSender = Arc<dyn Fn(String, String) -> Result<(), String> + Send + Sync>;

#[cfg(test)]
type TestTaskCloser = Arc<dyn Fn(String) -> Result<(), String> + Send + Sync>;

#[cfg(test)]
type TestStageAdvancer =
    Arc<dyn Fn(String) -> Result<crate::mobile_api::TaskActionResponse, String> + Send + Sync>;

#[cfg(test)]
type TestTaskTerminalStreamer =
    Arc<dyn Fn(String) -> Result<Vec<TaskTerminalStreamEvent>, String> + Send + Sync>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
enum TaskTerminalStreamEvent {
    Ready { task_id: String },
    Output { task_id: String, text: String },
    Exit { task_id: String, code: i32 },
    Error { task_id: String, message: String },
}

impl AppState {
    pub fn new(config: Config) -> Self {
        if let Err(err) = pairing::PairingStore::load(Path::new(&config.pairing_store_path)) {
            log::warn!(
                "failed to load pairing store {}: {}",
                config.pairing_store_path,
                err
            );
        }

        Self {
            config,
            pairing_session: Arc::new(Mutex::new(None)),
            #[cfg(test)]
            task_creator: None,
            #[cfg(test)]
            merge_agent_runner: None,
            #[cfg(test)]
            task_input_sender: None,
            #[cfg(test)]
            task_closer: None,
            #[cfg(test)]
            stage_advancer: None,
            #[cfg(test)]
            task_terminal_streamer: None,
        }
    }

    #[cfg(test)]
    fn with_task_creator(config: Config, task_creator: TestTaskCreator) -> Self {
        let mut state = Self::new(config);
        state.task_creator = Some(task_creator);
        state
    }

    #[cfg(test)]
    fn with_merge_agent_runner(config: Config, merge_agent_runner: TestMergeAgentRunner) -> Self {
        let mut state = Self::new(config);
        state.merge_agent_runner = Some(merge_agent_runner);
        state
    }

    #[cfg(test)]
    fn with_task_input_sender(config: Config, task_input_sender: TestTaskInputSender) -> Self {
        let mut state = Self::new(config);
        state.task_input_sender = Some(task_input_sender);
        state
    }

    #[cfg(test)]
    fn with_task_closer(config: Config, task_closer: TestTaskCloser) -> Self {
        let mut state = Self::new(config);
        state.task_closer = Some(task_closer);
        state
    }

    #[cfg(test)]
    fn with_stage_advancer(config: Config, stage_advancer: TestStageAdvancer) -> Self {
        let mut state = Self::new(config);
        state.stage_advancer = Some(stage_advancer);
        state
    }

    #[cfg(test)]
    fn with_task_terminal_streamer(
        config: Config,
        task_terminal_streamer: TestTaskTerminalStreamer,
    ) -> Self {
        let mut state = Self::new(config);
        state.task_terminal_streamer = Some(task_terminal_streamer);
        state
    }
}

async fn list_desktops(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<crate::mobile_api::DesktopDescriptor>>, (axum::http::StatusCode, String)> {
    let db = Db::open(&state.config.db_path).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {}", e),
        )
    })?;
    let api = MobileApi::new(state.config.clone(), db);
    let desktops = api
        .list_desktops()
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(desktops))
}

async fn list_repos(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<crate::mobile_api::RepoSummary>>, (axum::http::StatusCode, String)> {
    let db = Db::open(&state.config.db_path).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {}", e),
        )
    })?;
    let api = MobileApi::new(state.config.clone(), db);
    let repos = api
        .list_repos()
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(repos))
}

async fn list_repo_tasks(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(repo_id): axum::extract::Path<String>,
) -> Result<Json<Vec<crate::mobile_api::TaskSummary>>, (axum::http::StatusCode, String)> {
    let db = Db::open(&state.config.db_path).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {}", e),
        )
    })?;
    let api = MobileApi::new(state.config.clone(), db);
    let tasks = api
        .list_repo_tasks(&repo_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(tasks))
}

async fn status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<crate::mobile_api::MobileServerStatus>, (axum::http::StatusCode, String)> {
    let pairing_code = {
        let session = state.pairing_session.lock().await;
        pairing::active_pairing_code(session.as_ref())
    };
    Ok(Json(crate::mobile_api::build_mobile_server_status(
        &state.config,
        pairing_code,
    )))
}

async fn list_recent_tasks(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<crate::mobile_api::TaskSummary>>, (axum::http::StatusCode, String)> {
    let db = Db::open(&state.config.db_path).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {}", e),
        )
    })?;
    let api = MobileApi::new(state.config.clone(), db);
    let tasks = api
        .list_recent_tasks()
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(tasks))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchTasksQuery {
    query: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskInputRequest {
    input: String,
}

async fn search_tasks(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(query): axum::extract::Query<SearchTasksQuery>,
) -> Result<Json<Vec<crate::mobile_api::TaskSummary>>, (axum::http::StatusCode, String)> {
    let db = Db::open(&state.config.db_path).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {}", e),
        )
    })?;
    let api = MobileApi::new(state.config.clone(), db);
    let tasks = api
        .search_tasks(&query.query)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(tasks))
}

async fn create_pairing_session(
    State(state): State<Arc<AppState>>,
) -> Result<Json<PairingSession>, (axum::http::StatusCode, String)> {
    let session = pairing::create_pairing_session(&state.config)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    {
        let mut pairing_session = state.pairing_session.lock().await;
        *pairing_session = Some(session.clone());
    }
    Ok(Json(session))
}

async fn create_task(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<crate::mobile_api::CreateTaskRequest>,
) -> Result<Json<crate::mobile_api::CreateTaskResponse>, (axum::http::StatusCode, String)> {
    #[cfg(test)]
    if let Some(task_creator) = state.task_creator.clone() {
        return task_creator(payload)
            .map(Json)
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e));
    }

    let prepared = {
        let db = Db::open(&state.config.db_path).map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("db error: {}", e),
            )
        })?;
        crate::task_creator::prepare_task_for_api(&db, &state.config, payload)
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?
    };
    let mut daemon = crate::daemon_client::DaemonClient::connect(&state.config.daemon_dir)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("daemon error: {}", e),
            )
        })?;
    let created = crate::task_creator::spawn_prepared_task_for_api(&mut daemon, prepared)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(created))
}

async fn run_merge_agent(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(task_id): axum::extract::Path<String>,
) -> Result<Json<crate::mobile_api::TaskActionResponse>, (axum::http::StatusCode, String)> {
    #[cfg(test)]
    if let Some(merge_agent_runner) = state.merge_agent_runner.clone() {
        return merge_agent_runner(task_id)
            .map(Json)
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e));
    }

    let prepared = {
        let db = Db::open(&state.config.db_path).map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("db error: {}", e),
            )
        })?;
        crate::task_creator::prepare_merge_agent_for_api(&db, &state.config, &task_id)
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?
    };
    let mut daemon = crate::daemon_client::DaemonClient::connect(&state.config.daemon_dir)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("daemon error: {}", e),
            )
        })?;
    let created_task = crate::task_creator::spawn_prepared_task_for_api(&mut daemon, prepared)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(crate::mobile_api::TaskActionResponse {
        task_id: created_task.task_id,
    }))
}

async fn send_task_input(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(task_id): axum::extract::Path<String>,
    Json(payload): Json<TaskInputRequest>,
) -> Result<axum::http::StatusCode, (axum::http::StatusCode, String)> {
    #[cfg(test)]
    if let Some(task_input_sender) = state.task_input_sender.clone() {
        return task_input_sender(task_id, payload.input)
            .map(|_| axum::http::StatusCode::NO_CONTENT)
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e));
    }

    let mut daemon = crate::daemon_client::DaemonClient::connect(&state.config.daemon_dir)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("daemon error: {}", e),
            )
        })?;
    let event = daemon
        .send_command(&DaemonCommand::Input {
            session_id: task_id,
            data: payload.input.into_bytes(),
        })
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("daemon error: {}", e),
            )
        })?;

    match event {
        DaemonEvent::Ok => Ok(axum::http::StatusCode::NO_CONTENT),
        DaemonEvent::Error { message, .. } => {
            Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, message))
        }
        other => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("unexpected daemon response: {:?}", other),
        )),
    }
}

async fn close_task(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(task_id): axum::extract::Path<String>,
) -> Result<axum::http::StatusCode, (axum::http::StatusCode, String)> {
    #[cfg(test)]
    if let Some(task_closer) = state.task_closer.clone() {
        return task_closer(task_id)
            .map(|_| axum::http::StatusCode::NO_CONTENT)
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e));
    }

    let mut daemon = crate::daemon_client::DaemonClient::connect(&state.config.daemon_dir)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("daemon error: {}", e),
            )
        })?;

    for session_id in [
        task_id.to_string(),
        format!("shell-wt-{task_id}"),
        format!("td-{task_id}"),
    ] {
        let event = daemon
            .send_command(&DaemonCommand::Kill { session_id })
            .await
            .map_err(|e| {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("daemon error: {}", e),
                )
            })?;

        match event {
            DaemonEvent::Ok => {}
            DaemonEvent::Error {
                code: Some(kanna_daemon::protocol::ErrorCode::SessionNotFound),
                ..
            } => {}
            DaemonEvent::Error { message, .. } => {
                return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, message));
            }
            other => {
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("unexpected daemon response: {:?}", other),
                ));
            }
        }
    }

    let db = Db::open(&state.config.db_path).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {}", e),
        )
    })?;
    db.close_pipeline_item(&task_id).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {}", e),
        )
    })?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn advance_stage(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(task_id): axum::extract::Path<String>,
) -> Result<Json<crate::mobile_api::TaskActionResponse>, (axum::http::StatusCode, String)> {
    #[cfg(test)]
    if let Some(stage_advancer) = state.stage_advancer.clone() {
        return stage_advancer(task_id)
            .map(Json)
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e));
    }

    let prepared = {
        let db = Db::open(&state.config.db_path).map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("db error: {}", e),
            )
        })?;
        crate::task_creator::prepare_advance_stage_for_api(&db, &state.config, &task_id)
            .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?
    };
    let mut daemon = crate::daemon_client::DaemonClient::connect(&state.config.daemon_dir)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("daemon error: {}", e),
            )
        })?;
    let created = crate::task_creator::spawn_prepared_task_for_api(&mut daemon, prepared)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let db = Db::open(&state.config.db_path).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {}", e),
        )
    })?;
    db.close_pipeline_item(&task_id).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("db error: {}", e),
        )
    })?;

    Ok(Json(crate::mobile_api::TaskActionResponse {
        task_id: created.task_id,
    }))
}

async fn task_terminal(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    axum::extract::Path(task_id): axum::extract::Path<String>,
) -> axum::response::Response {
    ws.on_upgrade(move |socket| stream_task_terminal(socket, state, task_id))
}

async fn stream_task_terminal(socket: WebSocket, state: Arc<AppState>, task_id: String) {
    #[cfg(test)]
    if let Some(task_terminal_streamer) = state.task_terminal_streamer.clone() {
        match task_terminal_streamer(task_id.clone()) {
            Ok(events) => {
                stream_prebuilt_task_terminal_events(socket, events).await;
            }
            Err(message) => {
                stream_prebuilt_task_terminal_events(
                    socket,
                    vec![TaskTerminalStreamEvent::Error { task_id, message }],
                )
                .await;
            }
        }
        return;
    }

    let mut socket = socket;
    let daemon_result = crate::daemon_client::DaemonClient::connect(&state.config.daemon_dir)
        .await
        .map_err(|error| format!("daemon error: {error}"));
    let mut daemon = match daemon_result {
        Ok(daemon) => daemon,
        Err(message) => {
            let _ = send_task_terminal_event(
                &mut socket,
                TaskTerminalStreamEvent::Error { task_id, message },
            )
            .await;
            return;
        }
    };

    let observe_result = daemon
        .send_command(&DaemonCommand::Observe {
            session_id: task_id.clone(),
        })
        .await
        .map_err(|error| format!("daemon error: {error}"));
    match observe_result {
        Ok(DaemonEvent::Ok) => {
            if send_task_terminal_event(
                &mut socket,
                TaskTerminalStreamEvent::Ready {
                    task_id: task_id.clone(),
                },
            )
            .await
            .is_err()
            {
                return;
            }
        }
        Ok(DaemonEvent::Error { message, .. }) => {
            let _ = send_task_terminal_event(
                &mut socket,
                TaskTerminalStreamEvent::Error { task_id, message },
            )
            .await;
            return;
        }
        Ok(other) => {
            let _ = send_task_terminal_event(
                &mut socket,
                TaskTerminalStreamEvent::Error {
                    task_id,
                    message: format!("unexpected daemon response: {:?}", other),
                },
            )
            .await;
            return;
        }
        Err(message) => {
            let _ = send_task_terminal_event(
                &mut socket,
                TaskTerminalStreamEvent::Error { task_id, message },
            )
            .await;
            return;
        }
    }

    loop {
        let event = match daemon
            .read_event()
            .await
            .map_err(|error| format!("daemon read error: {error}"))
        {
            Ok(event) => event,
            Err(message) => {
                let _ = send_task_terminal_event(
                    &mut socket,
                    TaskTerminalStreamEvent::Error {
                        task_id: task_id.clone(),
                        message,
                    },
                )
                .await;
                break;
            }
        };

        let next_event = match event {
            DaemonEvent::Output { session_id, data } => {
                let text = strip_ansi_for_mobile(&String::from_utf8_lossy(&data));
                if text.is_empty() {
                    continue;
                }
                TaskTerminalStreamEvent::Output {
                    task_id: session_id,
                    text,
                }
            }
            DaemonEvent::Exit {
                session_id,
                code,
                ..
            } => TaskTerminalStreamEvent::Exit {
                task_id: session_id,
                code,
            },
            DaemonEvent::Error { message, .. } => TaskTerminalStreamEvent::Error {
                task_id: task_id.clone(),
                message,
            },
            _ => continue,
        };

        let should_stop = matches!(
            next_event,
            TaskTerminalStreamEvent::Exit { .. } | TaskTerminalStreamEvent::Error { .. }
        );
        if send_task_terminal_event(&mut socket, next_event)
            .await
            .is_err()
        {
            break;
        }
        if should_stop {
            break;
        }
    }
}

#[cfg(test)]
async fn stream_prebuilt_task_terminal_events(
    mut socket: WebSocket,
    events: Vec<TaskTerminalStreamEvent>,
) {
    for event in events {
        let should_stop = matches!(
            event,
            TaskTerminalStreamEvent::Exit { .. } | TaskTerminalStreamEvent::Error { .. }
        );
        if send_task_terminal_event(&mut socket, event).await.is_err() {
            break;
        }
        if should_stop {
            break;
        }
    }
}

async fn send_task_terminal_event(
    socket: &mut WebSocket,
    event: TaskTerminalStreamEvent,
) -> Result<(), ()> {
    let json = serde_json::to_string(&event).map_err(|_| ())?;
    socket
        .send(WebSocketMessage::Text(json.into()))
        .await
        .map_err(|_| ())
}

fn strip_ansi_for_mobile(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        match bytes[i] {
            0x1b => {
                i += 1;
                if i >= len {
                    break;
                }
                match bytes[i] {
                    b'[' => {
                        i += 1;
                        while i < len && !bytes[i].is_ascii_alphabetic() {
                            i += 1;
                        }
                        if i < len {
                            let cmd = bytes[i];
                            i += 1;
                            match cmd {
                                b'B' => result.push('\n'),
                                b'C' => result.push(' '),
                                _ => {}
                            }
                        }
                    }
                    b']' => {
                        i += 1;
                        while i < len {
                            if bytes[i] == 0x07 {
                                i += 1;
                                break;
                            }
                            if bytes[i] == 0x1b && i + 1 < len && bytes[i + 1] == b'\\' {
                                i += 2;
                                break;
                            }
                            i += 1;
                        }
                    }
                    _ => {}
                }
            }
            byte => {
                result.push(byte as char);
                i += 1;
            }
        }
    }

    result
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/status", get(status))
        .route("/v1/desktops", get(list_desktops))
        .route("/v1/repos", get(list_repos))
        .route("/v1/repos/{repo_id}/tasks", get(list_repo_tasks))
        .route("/v1/tasks/recent", get(list_recent_tasks))
        .route("/v1/tasks/search", get(search_tasks))
        .route("/v1/tasks", post(create_task))
        .route("/v1/tasks/{task_id}/terminal", get(task_terminal))
        .route("/v1/tasks/{task_id}/input", post(send_task_input))
        .route(
            "/v1/tasks/{task_id}/actions/advance-stage",
            post(advance_stage),
        )
        .route("/v1/tasks/{task_id}/actions/close", post(close_task))
        .route(
            "/v1/tasks/{task_id}/actions/run-merge-agent",
            post(run_merge_agent),
        )
        .route("/v1/pairing/sessions", post(create_pairing_session))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

pub async fn serve(state: Arc<AppState>) -> Result<(), String> {
    let bind_addr = format!("{}:{}", state.config.lan_host, state.config.lan_port);
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| format!("failed to bind LAN API on {}: {}", bind_addr, e))?;
    log::info!("LAN API listening on {}", bind_addr);
    axum::serve(listener, router(state))
        .await
        .map_err(|e| format!("LAN API server failed: {}", e))
}

#[cfg(test)]
fn test_router(desktop_id: &str, desktop_name: &str) -> Router {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEST_DB_ID: AtomicUsize = AtomicUsize::new(1);
    let test_db_id = NEXT_TEST_DB_ID.fetch_add(1, Ordering::Relaxed);
    let config = Config {
        relay_url: "wss://relay.example".to_string(),
        device_token: "device-token".to_string(),
        daemon_dir: "/tmp/kanna-daemon".to_string(),
        db_path: Db::test_db_path(&format!("http-api-{desktop_id}-{test_db_id}")),
        desktop_id: desktop_id.to_string(),
        desktop_name: desktop_name.to_string(),
        lan_host: "0.0.0.0".to_string(),
        lan_port: 48120,
        pairing_store_path: format!("/tmp/kanna-pairings-{desktop_id}-{test_db_id}.json"),
    };
    let _ = Db::open_for_tests(&config.db_path).expect("open test db");
    router(Arc::new(AppState::new(config)))
}

#[cfg(test)]
fn test_router_with_seed(desktop_id: &str, desktop_name: &str, seed: impl FnOnce(&Db)) -> Router {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEST_DB_ID: AtomicUsize = AtomicUsize::new(5_000);
    let test_db_id = NEXT_TEST_DB_ID.fetch_add(1, Ordering::Relaxed);
    let config = Config {
        relay_url: "wss://relay.example".to_string(),
        device_token: "device-token".to_string(),
        daemon_dir: "/tmp/kanna-daemon".to_string(),
        db_path: Db::test_db_path(&format!("http-api-{desktop_id}-{test_db_id}")),
        desktop_id: desktop_id.to_string(),
        desktop_name: desktop_name.to_string(),
        lan_host: "0.0.0.0".to_string(),
        lan_port: 48120,
        pairing_store_path: format!("/tmp/kanna-pairings-{desktop_id}-{test_db_id}.json"),
    };
    let db = Db::open_for_tests(&config.db_path).expect("open test db");
    seed(&db);
    router(Arc::new(AppState::new(config)))
}

#[cfg(test)]
fn test_router_with_task_creator(
    desktop_id: &str,
    desktop_name: &str,
    task_creator: TestTaskCreator,
) -> Router {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEST_DB_ID: AtomicUsize = AtomicUsize::new(10_000);
    let test_db_id = NEXT_TEST_DB_ID.fetch_add(1, Ordering::Relaxed);
    let config = Config {
        relay_url: "wss://relay.example".to_string(),
        device_token: "device-token".to_string(),
        daemon_dir: "/tmp/kanna-daemon".to_string(),
        db_path: Db::test_db_path(&format!("http-api-{desktop_id}-{test_db_id}")),
        desktop_id: desktop_id.to_string(),
        desktop_name: desktop_name.to_string(),
        lan_host: "0.0.0.0".to_string(),
        lan_port: 48120,
        pairing_store_path: format!("/tmp/kanna-pairings-{desktop_id}-{test_db_id}.json"),
    };
    let _ = Db::open_for_tests(&config.db_path).expect("open test db");
    router(Arc::new(AppState::with_task_creator(config, task_creator)))
}

#[cfg(test)]
fn test_router_with_merge_agent_runner(
    desktop_id: &str,
    desktop_name: &str,
    merge_agent_runner: TestMergeAgentRunner,
) -> Router {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEST_DB_ID: AtomicUsize = AtomicUsize::new(20_000);
    let test_db_id = NEXT_TEST_DB_ID.fetch_add(1, Ordering::Relaxed);
    let config = Config {
        relay_url: "wss://relay.example".to_string(),
        device_token: "device-token".to_string(),
        daemon_dir: "/tmp/kanna-daemon".to_string(),
        db_path: Db::test_db_path(&format!("http-api-{desktop_id}-{test_db_id}")),
        desktop_id: desktop_id.to_string(),
        desktop_name: desktop_name.to_string(),
        lan_host: "0.0.0.0".to_string(),
        lan_port: 48120,
        pairing_store_path: format!("/tmp/kanna-pairings-{desktop_id}-{test_db_id}.json"),
    };
    let _ = Db::open_for_tests(&config.db_path).expect("open test db");
    router(Arc::new(AppState::with_merge_agent_runner(
        config,
        merge_agent_runner,
    )))
}

#[cfg(test)]
fn test_router_with_task_input_sender(
    desktop_id: &str,
    desktop_name: &str,
    task_input_sender: TestTaskInputSender,
) -> Router {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEST_DB_ID: AtomicUsize = AtomicUsize::new(25_000);
    let test_db_id = NEXT_TEST_DB_ID.fetch_add(1, Ordering::Relaxed);
    let config = Config {
        relay_url: "wss://relay.example".to_string(),
        device_token: "device-token".to_string(),
        daemon_dir: "/tmp/kanna-daemon".to_string(),
        db_path: Db::test_db_path(&format!("http-api-{desktop_id}-{test_db_id}")),
        desktop_id: desktop_id.to_string(),
        desktop_name: desktop_name.to_string(),
        lan_host: "0.0.0.0".to_string(),
        lan_port: 48120,
        pairing_store_path: format!("/tmp/kanna-pairings-{desktop_id}-{test_db_id}.json"),
    };
    let _ = Db::open_for_tests(&config.db_path).expect("open test db");
    router(Arc::new(AppState::with_task_input_sender(
        config,
        task_input_sender,
    )))
}

#[cfg(test)]
fn test_router_with_task_closer(
    desktop_id: &str,
    desktop_name: &str,
    task_closer: TestTaskCloser,
) -> Router {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEST_DB_ID: AtomicUsize = AtomicUsize::new(27_500);
    let test_db_id = NEXT_TEST_DB_ID.fetch_add(1, Ordering::Relaxed);
    let config = Config {
        relay_url: "wss://relay.example".to_string(),
        device_token: "device-token".to_string(),
        daemon_dir: "/tmp/kanna-daemon".to_string(),
        db_path: Db::test_db_path(&format!("http-api-{desktop_id}-{test_db_id}")),
        desktop_id: desktop_id.to_string(),
        desktop_name: desktop_name.to_string(),
        lan_host: "0.0.0.0".to_string(),
        lan_port: 48120,
        pairing_store_path: format!("/tmp/kanna-pairings-{desktop_id}-{test_db_id}.json"),
    };
    let _ = Db::open_for_tests(&config.db_path).expect("open test db");
    router(Arc::new(AppState::with_task_closer(config, task_closer)))
}

#[cfg(test)]
fn test_router_with_stage_advancer(
    desktop_id: &str,
    desktop_name: &str,
    stage_advancer: TestStageAdvancer,
) -> Router {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEST_DB_ID: AtomicUsize = AtomicUsize::new(28_500);
    let test_db_id = NEXT_TEST_DB_ID.fetch_add(1, Ordering::Relaxed);
    let config = Config {
        relay_url: "wss://relay.example".to_string(),
        device_token: "device-token".to_string(),
        daemon_dir: "/tmp/kanna-daemon".to_string(),
        db_path: Db::test_db_path(&format!("http-api-{desktop_id}-{test_db_id}")),
        desktop_id: desktop_id.to_string(),
        desktop_name: desktop_name.to_string(),
        lan_host: "0.0.0.0".to_string(),
        lan_port: 48120,
        pairing_store_path: format!("/tmp/kanna-pairings-{desktop_id}-{test_db_id}.json"),
    };
    let _ = Db::open_for_tests(&config.db_path).expect("open test db");
    router(Arc::new(AppState::with_stage_advancer(
        config,
        stage_advancer,
    )))
}

#[cfg(test)]
fn test_router_with_terminal_streamer(
    desktop_id: &str,
    desktop_name: &str,
    task_terminal_streamer: TestTaskTerminalStreamer,
) -> Router {
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEST_DB_ID: AtomicUsize = AtomicUsize::new(30_000);
    let test_db_id = NEXT_TEST_DB_ID.fetch_add(1, Ordering::Relaxed);
    let config = Config {
        relay_url: "wss://relay.example".to_string(),
        device_token: "device-token".to_string(),
        daemon_dir: "/tmp/kanna-daemon".to_string(),
        db_path: Db::test_db_path(&format!("http-api-{desktop_id}-{test_db_id}")),
        desktop_id: desktop_id.to_string(),
        desktop_name: desktop_name.to_string(),
        lan_host: "127.0.0.1".to_string(),
        lan_port: 48120,
        pairing_store_path: format!("/tmp/kanna-pairings-{desktop_id}-{test_db_id}.json"),
    };
    let _ = Db::open_for_tests(&config.db_path).expect("open test db");
    router(Arc::new(AppState::with_task_terminal_streamer(
        config,
        task_terminal_streamer,
    )))
}

#[cfg(test)]
mod tests {
    use crate::mobile_api::{CreateTaskResponse, MobileServerStatus, TaskActionResponse};
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use serde_json::from_slice;
    use std::sync::Arc;
    use tower::ServiceExt;

    #[tokio::test]
    async fn list_desktops_route_returns_configured_desktop() {
        let app = super::test_router("desktop-1", "Studio Mac");
        let response = app
            .oneshot(Request::get("/v1/desktops").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn list_repos_route_returns_repo_summaries() {
        let app = super::test_router_with_seed("desktop-1", "Studio Mac", |db| {
            db.insert_test_repo("repo-1", "Repo One").unwrap();
            db.insert_test_repo("repo-2", "Repo Two").unwrap();
        });

        let response = app
            .oneshot(Request::get("/v1/repos").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let repos: Vec<crate::mobile_api::RepoSummary> = from_slice(&body).unwrap();
        assert_eq!(
            repos,
            vec![
                crate::mobile_api::RepoSummary {
                    id: "repo-1".to_string(),
                    name: "Repo One".to_string(),
                },
                crate::mobile_api::RepoSummary {
                    id: "repo-2".to_string(),
                    name: "Repo Two".to_string(),
                },
            ]
        );
    }

    #[tokio::test]
    async fn list_repo_tasks_route_returns_repo_scoped_tasks() {
        let app = super::test_router_with_seed("desktop-1", "Studio Mac", |db| {
            db.insert_test_repo("repo-1", "Repo One").unwrap();
            db.insert_test_repo("repo-2", "Repo Two").unwrap();
            db.insert_test_pipeline_item(
                "task-repo-1",
                "repo-1",
                "repo one prompt",
                Some("Repo One Task"),
                "in progress",
                "2026-04-17 07:00:00",
            )
            .unwrap();
            db.insert_test_pipeline_item(
                "task-repo-2",
                "repo-2",
                "repo two prompt",
                Some("Repo Two Task"),
                "pr",
                "2026-04-17 08:00:00",
            )
            .unwrap();
        });

        let response = app
            .oneshot(
                Request::get("/v1/repos/repo-1/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let tasks: Vec<crate::mobile_api::TaskSummary> = from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "task-repo-1");
        assert_eq!(tasks[0].repo_id, "repo-1");
    }

    #[tokio::test]
    async fn list_recent_tasks_route_returns_open_tasks_in_updated_order() {
        let app = super::test_router_with_seed("desktop-1", "Studio Mac", |db| {
            db.insert_test_repo("repo-1", "Repo One").unwrap();
            db.insert_test_pipeline_item(
                "task-older",
                "repo-1",
                "older prompt",
                Some("Older Task"),
                "in progress",
                "2026-04-17 06:00:00",
            )
            .unwrap();
            db.insert_test_pipeline_item(
                "task-newer",
                "repo-1",
                "newer prompt",
                Some("Newer Task"),
                "pr",
                "2026-04-17 07:00:00",
            )
            .unwrap();
            db.insert_test_pipeline_item(
                "task-done",
                "repo-1",
                "done prompt",
                Some("Done Task"),
                "done",
                "2026-04-17 08:00:00",
            )
            .unwrap();
            db.update_test_pipeline_item_preview("task-newer", Some("Latest agent output preview"))
                .unwrap();
        });

        let response = app
            .oneshot(Request::get("/v1/tasks/recent").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let tasks: Vec<crate::mobile_api::TaskSummary> = from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].id, "task-newer");
        assert_eq!(tasks[0].snippet.as_deref(), Some("Latest agent output preview"));
        assert_eq!(tasks[1].id, "task-older");
    }

    #[tokio::test]
    async fn search_tasks_route_filters_by_query_text() {
        let app = super::test_router_with_seed("desktop-1", "Studio Mac", |db| {
            db.insert_test_repo("repo-1", "Repo One").unwrap();
            db.insert_test_pipeline_item(
                "task-merge",
                "repo-1",
                "follow up on merge conflicts",
                Some("Merge Cleanup"),
                "in progress",
                "2026-04-17 07:00:00",
            )
            .unwrap();
            db.insert_test_pipeline_item(
                "task-other",
                "repo-1",
                "write release notes",
                Some("Docs"),
                "in progress",
                "2026-04-17 06:00:00",
            )
            .unwrap();
            db.insert_test_pipeline_item(
                "task-done",
                "repo-1",
                "merge old branch",
                Some("Done Merge"),
                "done",
                "2026-04-17 08:00:00",
            )
            .unwrap();
        });

        let response = app
            .oneshot(
                Request::get("/v1/tasks/search?query=merge")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let tasks: Vec<crate::mobile_api::TaskSummary> = from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "task-merge");
        assert_eq!(tasks[0].title, "Merge Cleanup");
    }

    #[tokio::test]
    async fn create_pairing_session_route_returns_pairing_payload() {
        let app = super::test_router("desktop-1", "Studio Mac");
        let response = app
            .oneshot(
                Request::post("/v1/pairing/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let pairing: crate::pairing::PairingSession = from_slice(&body).unwrap();
        assert_eq!(pairing.desktop_id, "desktop-1");
        assert_eq!(pairing.desktop_name, "Studio Mac");
        assert_eq!(pairing.lan_port, 48120);
        assert_eq!(pairing.code.len(), 6);
    }

    #[tokio::test]
    async fn create_task_route_uses_task_creator() {
        let app = super::test_router_with_task_creator(
            "desktop-1",
            "Studio Mac",
            Arc::new(|payload| {
                Ok(CreateTaskResponse {
                    task_id: "task-1".to_string(),
                    repo_id: payload.repo_id,
                    title: payload.prompt,
                    stage: "in progress".to_string(),
                })
            }),
        );

        let response = app
            .oneshot(
                Request::post("/v1/tasks")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "repoId": "repo-1",
                            "prompt": "Ship it"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: CreateTaskResponse = from_slice(&body).unwrap();
        assert_eq!(created.task_id, "task-1");
        assert_eq!(created.repo_id, "repo-1");
        assert_eq!(created.title, "Ship it");
        assert_eq!(created.stage, "in progress");
    }

    #[tokio::test]
    async fn run_merge_agent_route_uses_merge_agent_runner() {
        let app = super::test_router_with_merge_agent_runner(
            "desktop-1",
            "Studio Mac",
            Arc::new(|task_id| {
                Ok(TaskActionResponse {
                    task_id: format!("merge-{task_id}"),
                })
            }),
        );

        let response = app
            .oneshot(
                Request::post("/v1/tasks/task-1/actions/run-merge-agent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: TaskActionResponse = from_slice(&body).unwrap();
        assert_eq!(created.task_id, "merge-task-1");
    }

    #[tokio::test]
    async fn send_task_input_route_uses_input_sender() {
        let app = super::test_router_with_task_input_sender(
            "desktop-1",
            "Studio Mac",
            Arc::new(|task_id, input| {
                assert_eq!(task_id, "task-1");
                assert_eq!(input, "continue");
                Ok(())
            }),
        );

        let response = app
            .oneshot(
                Request::post("/v1/tasks/task-1/input")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "input": "continue"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn close_task_route_uses_task_closer() {
        let app = super::test_router_with_task_closer(
            "desktop-1",
            "Studio Mac",
            Arc::new(|task_id| {
                assert_eq!(task_id, "task-1");
                Ok(())
            }),
        );

        let response = app
            .oneshot(
                Request::post("/v1/tasks/task-1/actions/close")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn advance_stage_route_uses_stage_advancer() {
        let app = super::test_router_with_stage_advancer(
            "desktop-1",
            "Studio Mac",
            Arc::new(|task_id| {
                assert_eq!(task_id, "task-1");
                Ok(TaskActionResponse {
                    task_id: "task-2".to_string(),
                })
            }),
        );

        let response = app
            .oneshot(
                Request::post("/v1/tasks/task-1/actions/advance-stage")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: TaskActionResponse = from_slice(&body).unwrap();
        assert_eq!(created.task_id, "task-2");
    }

    #[tokio::test]
    async fn task_terminal_route_streams_output_events() {
        use futures_util::StreamExt;
        use serde_json::Value;
        use tokio::net::TcpListener;
        use tokio_tungstenite::connect_async;
        use tokio_tungstenite::tungstenite::Message;

        let app = super::test_router_with_terminal_streamer(
            "desktop-1",
            "Studio Mac",
            Arc::new(|task_id| {
                Ok(vec![
                    super::TaskTerminalStreamEvent::Ready {
                        task_id: task_id.clone(),
                    },
                    super::TaskTerminalStreamEvent::Output {
                        task_id: task_id.clone(),
                        text: "hello from daemon".to_string(),
                    },
                    super::TaskTerminalStreamEvent::Exit { task_id, code: 0 },
                ])
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app.into_make_service())
                .await
                .unwrap();
        });

        let (mut socket, _) = connect_async(format!("ws://{addr}/v1/tasks/task-1/terminal"))
            .await
            .unwrap();

        let ready = socket.next().await.unwrap().unwrap();
        let output = socket.next().await.unwrap().unwrap();
        let exit = socket.next().await.unwrap().unwrap();

        server.abort();

        let parse = |message: Message| -> Value {
            match message {
                Message::Text(text) => serde_json::from_str(&text).unwrap(),
                other => panic!("expected text websocket frame, got {:?}", other),
            }
        };

        assert_eq!(parse(ready)["type"], "ready");
        assert_eq!(parse(output)["text"], "hello from daemon");
        assert_eq!(parse(exit)["type"], "exit");
    }

    #[tokio::test]
    async fn status_route_reflects_pairing_session() {
        let app = super::test_router("desktop-1", "Studio Mac");
        let pairing_response = app
            .clone()
            .oneshot(
                Request::post("/v1/pairing/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(pairing_response.status(), StatusCode::OK);

        let status_response = app
            .oneshot(Request::get("/v1/status").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(status_response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(status_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let status: MobileServerStatus = from_slice(&body).unwrap();

        assert_eq!(status.desktop_name, "Studio Mac");
        assert_eq!(status.state, "running");
        assert!(status.pairing_code.is_some());
    }
}

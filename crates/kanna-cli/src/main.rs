use clap::{Parser, Subcommand};
use rusqlite::Connection;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::io::{BufRead, Write};
use std::process;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;

const DEFAULT_SERVER_BASE_URL: &str = "http://127.0.0.1:48120";

#[derive(Parser)]
#[command(name = "kanna-cli")]
#[command(about = "Kanna CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Signal that a pipeline stage is complete
    StageComplete {
        /// The task/pipeline_item ID
        #[arg(long)]
        task_id: String,

        /// Completion status: "success" or "failure"
        #[arg(long)]
        status: String,

        /// Human-readable summary of what happened
        #[arg(long)]
        summary: String,

        /// Optional JSON string with extra metadata
        #[arg(long)]
        metadata: Option<String>,

        /// Override the local Kanna server base URL
        #[arg(long)]
        server_url: Option<String>,
    },
    /// List repos from the desktop-backed local API
    Repo {
        #[command(subcommand)]
        command: RepoCommands,
    },
    /// Create and inspect tasks through the desktop-backed local API
    Task {
        #[command(subcommand)]
        command: TaskCommands,
    },
    /// Run a stdio MCP server exposing Kanna task-control tools
    Mcp {
        #[command(subcommand)]
        command: McpCommands,
    },
}

#[derive(Subcommand)]
enum RepoCommands {
    /// List repos known to the running desktop server
    List {
        /// Override the local Kanna server base URL
        #[arg(long)]
        server_url: Option<String>,
    },
}

#[derive(Subcommand)]
enum TaskCommands {
    /// Create a task in a repo known to the running desktop server
    Create {
        /// The target repo ID
        #[arg(long)]
        repo_id: String,

        /// The task prompt
        #[arg(long)]
        prompt: String,

        /// Override the local Kanna server base URL
        #[arg(long)]
        server_url: Option<String>,

        /// Optional pipeline name override
        #[arg(long)]
        pipeline_name: Option<String>,

        /// Optional base ref override
        #[arg(long)]
        base_ref: Option<String>,

        /// Optional stage override
        #[arg(long)]
        stage: Option<String>,

        /// Optional agent provider override
        #[arg(long)]
        agent_provider: Option<String>,

        /// Optional model override
        #[arg(long)]
        model: Option<String>,

        /// Optional permission mode override
        #[arg(long)]
        permission_mode: Option<String>,

        /// Allowed tool override. Repeat to pass multiple values.
        #[arg(long)]
        allowed_tool: Vec<String>,
    },
    /// Request a new revision task from an existing task branch
    RequestRevision {
        /// The source task/pipeline_item ID
        #[arg(long)]
        task_id: String,

        /// Stage to create the revision task in
        #[arg(long, default_value = "in progress")]
        target_stage: String,

        /// Human-readable summary of why revision is needed
        #[arg(long)]
        summary: String,

        /// Prompt for the revision task
        #[arg(long)]
        prompt: String,

        /// Optional JSON string with extra metadata
        #[arg(long)]
        metadata: Option<String>,

        /// Override the local Kanna server base URL
        #[arg(long)]
        server_url: Option<String>,
    },
}

#[derive(Subcommand)]
enum McpCommands {
    /// Serve MCP over newline-delimited JSON-RPC on stdin/stdout
    Serve {
        /// Override the local Kanna server base URL
        #[arg(long)]
        server_url: Option<String>,
    },
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
struct RepoSummary {
    id: String,
    name: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CreateTaskRequest {
    repo_id: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pipeline_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allowed_tools: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CreateTaskResponse {
    task_id: String,
    repo_id: String,
    title: String,
    stage: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CompleteStageRequest {
    status: String,
    summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RequestRevisionRequest {
    target_stage: String,
    summary: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<Value>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TaskActionResponse {
    task_id: String,
}

struct TaskCreateOptions {
    repo_id: String,
    prompt: String,
    pipeline_name: Option<String>,
    base_ref: Option<String>,
    stage: Option<String>,
    agent_provider: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    allowed_tool: Vec<String>,
}

fn write_stage_result_to_db(
    db_path: &str,
    task_id: &str,
    stage_result: &str,
) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;

    let rows_updated = conn
        .execute(
            "UPDATE pipeline_item SET stage_result = ? WHERE id = ?",
            rusqlite::params![stage_result, task_id],
        )
        .map_err(|e| format!("Failed to update pipeline_item: {e}"))?;

    if rows_updated == 0 {
        return Err(format!("No pipeline_item found with id '{task_id}'"));
    }

    Ok(())
}

async fn notify_socket(socket_path: &str, task_id: &str) -> Result<(), String> {
    let mut stream = UnixStream::connect(socket_path)
        .await
        .map_err(|e| format!("Failed to connect to socket: {e}"))?;

    let message = serde_json::json!({
        "type": "stage_complete",
        "task_id": task_id,
    });

    let mut payload =
        serde_json::to_string(&message).map_err(|e| format!("Failed to serialize message: {e}"))?;
    payload.push('\n');

    stream
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to socket: {e}"))?;

    stream
        .shutdown()
        .await
        .map_err(|e| format!("Failed to shutdown socket: {e}"))?;

    Ok(())
}

fn env_var_from_pairs(env_pairs: &[(&str, &str)], key: &str) -> Option<String> {
    env_pairs
        .iter()
        .find_map(|(candidate, value)| (*candidate == key).then(|| (*value).to_string()))
}

fn resolve_stage_db_path(env_pairs: &[(&str, &str)]) -> Result<String, String> {
    if let Some(db_path) = env_var_from_pairs(env_pairs, "KANNA_CLI_DB_PATH") {
        return Ok(db_path);
    }

    Err("KANNA_CLI_DB_PATH environment variable is not set".to_string())
}

fn resolve_stage_db_path_from_env() -> Result<String, String> {
    let env_pairs = env::vars().collect::<Vec<_>>();
    let borrowed_pairs = env_pairs
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect::<Vec<_>>();
    resolve_stage_db_path(&borrowed_pairs)
}

fn resolve_server_base_url(
    env_pairs: &[(&str, &str)],
    explicit_server_url: Option<&str>,
) -> String {
    explicit_server_url
        .map(str::to_string)
        .or_else(|| env_var_from_pairs(env_pairs, "KANNA_SERVER_BASE_URL"))
        .unwrap_or_else(|| DEFAULT_SERVER_BASE_URL.to_string())
}

fn resolve_optional_server_base_url(
    env_pairs: &[(&str, &str)],
    explicit_server_url: Option<&str>,
) -> Option<String> {
    explicit_server_url
        .map(str::to_string)
        .or_else(|| env_var_from_pairs(env_pairs, "KANNA_SERVER_BASE_URL"))
}

fn resolve_server_base_url_from_env(explicit_server_url: Option<&str>) -> String {
    let env_pairs = env::vars().collect::<Vec<_>>();
    let borrowed_pairs = env_pairs
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect::<Vec<_>>();
    resolve_server_base_url(&borrowed_pairs, explicit_server_url)
}

fn build_create_task_request(options: TaskCreateOptions) -> CreateTaskRequest {
    CreateTaskRequest {
        repo_id: options.repo_id,
        prompt: options.prompt,
        pipeline_name: options.pipeline_name,
        base_ref: options.base_ref,
        stage: options.stage,
        agent_provider: options.agent_provider,
        model: options.model,
        permission_mode: options.permission_mode,
        allowed_tools: (!options.allowed_tool.is_empty()).then_some(options.allowed_tool),
    }
}

fn build_complete_stage_request(
    status: String,
    summary: String,
    metadata: Option<Value>,
) -> CompleteStageRequest {
    CompleteStageRequest {
        status,
        summary,
        metadata,
    }
}

fn build_request_revision_request(
    target_stage: String,
    summary: String,
    prompt: String,
    metadata: Option<Value>,
) -> RequestRevisionRequest {
    RequestRevisionRequest {
        target_stage,
        summary,
        prompt,
        metadata,
    }
}

fn parse_metadata_json(metadata: &Option<String>) -> Result<Option<Value>, String> {
    match metadata {
        Some(json_str) => serde_json::from_str(json_str)
            .map(Some)
            .map_err(|e| format!("--metadata is not valid JSON: {e}")),
        None => Ok(None),
    }
}

fn join_server_url(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

async fn get_json<T: DeserializeOwned>(base_url: &str, path: &str) -> Result<T, String> {
    let response = reqwest::Client::new()
        .get(join_server_url(base_url, path))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let response = response
        .error_for_status()
        .map_err(|e| format!("request failed: {e}"))?;
    response
        .json::<T>()
        .await
        .map_err(|e| format!("failed to decode response: {e}"))
}

async fn post_json<B: Serialize, T: DeserializeOwned>(
    base_url: &str,
    path: &str,
    body: &B,
) -> Result<T, String> {
    let response = reqwest::Client::new()
        .post(join_server_url(base_url, path))
        .json(body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let response = response
        .error_for_status()
        .map_err(|e| format!("request failed: {e}"))?;
    response
        .json::<T>()
        .await
        .map_err(|e| format!("failed to decode response: {e}"))
}

async fn list_repos_via_api(base_url: &str) -> Result<Vec<RepoSummary>, String> {
    get_json(base_url, "/v1/repos").await
}

async fn create_task_via_api(
    base_url: &str,
    request: &CreateTaskRequest,
) -> Result<CreateTaskResponse, String> {
    post_json(base_url, "/v1/tasks", request).await
}

async fn complete_stage_via_api(
    base_url: &str,
    task_id: &str,
    request: &CompleteStageRequest,
) -> Result<TaskActionResponse, String> {
    post_json(
        base_url,
        &format!("/v1/tasks/{task_id}/actions/complete-stage"),
        request,
    )
    .await
}

async fn request_revision_via_api(
    base_url: &str,
    task_id: &str,
    request: &RequestRevisionRequest,
) -> Result<TaskActionResponse, String> {
    post_json(
        base_url,
        &format!("/v1/tasks/{task_id}/actions/request-revision"),
        request,
    )
    .await
}

async fn advance_stage_via_api(base_url: &str, task_id: &str) -> Result<TaskActionResponse, String> {
    post_json(
        base_url,
        &format!("/v1/tasks/{task_id}/actions/advance-stage"),
        &serde_json::json!({}),
    )
    .await
}

fn mcp_response(id: Value, result: Value) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

fn mcp_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message.into(),
        },
    })
}

fn mcp_tools() -> Value {
    serde_json::json!([
        {
            "name": "complete_stage",
            "description": "Record completion for the current Kanna pipeline stage.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "status": { "type": "string", "enum": ["success", "failure"] },
                    "summary": { "type": "string" },
                    "metadata": { "type": "object" }
                },
                "required": ["task_id", "status", "summary"]
            }
        },
        {
            "name": "request_revision",
            "description": "Create a new revision task from the current task branch.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "target_stage": { "type": "string" },
                    "summary": { "type": "string" },
                    "prompt": { "type": "string" },
                    "metadata": { "type": "object" }
                },
                "required": ["task_id", "summary", "prompt"]
            }
        },
        {
            "name": "advance_stage",
            "description": "Advance a Kanna task to the next pipeline stage.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" }
                },
                "required": ["task_id"]
            }
        },
        {
            "name": "create_task",
            "description": "Create a new Kanna task.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "repo_id": { "type": "string" },
                    "prompt": { "type": "string" },
                    "pipeline_name": { "type": "string" },
                    "base_ref": { "type": "string" },
                    "stage": { "type": "string" },
                    "agent_provider": { "type": "string" },
                    "model": { "type": "string" },
                    "permission_mode": { "type": "string" },
                    "allowed_tools": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["repo_id", "prompt"]
            }
        }
    ])
}

fn required_string(args: &Value, name: &str) -> Result<String, String> {
    args.get(name)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("missing required argument: {name}"))
}

async fn handle_mcp_tool_call(base_url: &str, name: &str, args: Value) -> Result<Value, String> {
    match name {
        "complete_stage" => {
            let task_id = required_string(&args, "task_id")?;
            let request = build_complete_stage_request(
                required_string(&args, "status")?,
                required_string(&args, "summary")?,
                args.get("metadata").cloned(),
            );
            serde_json::to_value(complete_stage_via_api(base_url, &task_id, &request).await?)
                .map_err(|e| format!("failed to encode response: {e}"))
        }
        "request_revision" => {
            let task_id = required_string(&args, "task_id")?;
            let request = build_request_revision_request(
                args.get("target_stage")
                    .and_then(Value::as_str)
                    .unwrap_or("in progress")
                    .to_string(),
                required_string(&args, "summary")?,
                required_string(&args, "prompt")?,
                args.get("metadata").cloned(),
            );
            serde_json::to_value(request_revision_via_api(base_url, &task_id, &request).await?)
                .map_err(|e| format!("failed to encode response: {e}"))
        }
        "advance_stage" => {
            let task_id = required_string(&args, "task_id")?;
            serde_json::to_value(advance_stage_via_api(base_url, &task_id).await?)
                .map_err(|e| format!("failed to encode response: {e}"))
        }
        "create_task" => {
            let allowed_tool = args
                .get("allowed_tools")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let request = build_create_task_request(TaskCreateOptions {
                repo_id: required_string(&args, "repo_id")?,
                prompt: required_string(&args, "prompt")?,
                pipeline_name: args.get("pipeline_name").and_then(Value::as_str).map(str::to_string),
                base_ref: args.get("base_ref").and_then(Value::as_str).map(str::to_string),
                stage: args.get("stage").and_then(Value::as_str).map(str::to_string),
                agent_provider: args.get("agent_provider").and_then(Value::as_str).map(str::to_string),
                model: args.get("model").and_then(Value::as_str).map(str::to_string),
                permission_mode: args.get("permission_mode").and_then(Value::as_str).map(str::to_string),
                allowed_tool,
            });
            serde_json::to_value(create_task_via_api(base_url, &request).await?)
                .map_err(|e| format!("failed to encode response: {e}"))
        }
        _ => Err(format!("unknown tool: {name}")),
    }
}

async fn handle_mcp_request(message: Value, base_url: &str) -> Value {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return mcp_error(id, -32600, "missing method");
    };

    match method {
        "initialize" => mcp_response(
            id,
            serde_json::json!({
                "protocolVersion": "2025-11-25",
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "kanna-cli",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }),
        ),
        "notifications/initialized" => Value::Null,
        "tools/list" => mcp_response(id, serde_json::json!({ "tools": mcp_tools() })),
        "tools/call" => {
            let params = message.get("params").cloned().unwrap_or_else(|| serde_json::json!({}));
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return mcp_error(id, -32602, "missing tool name");
            };
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            match handle_mcp_tool_call(base_url, name, args).await {
                Ok(value) => mcp_response(
                    id,
                    serde_json::json!({
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
                        }]
                    }),
                ),
                Err(message) => mcp_error(id, -32603, message),
            }
        }
        _ => mcp_error(id, -32601, format!("unknown method: {method}")),
    }
}

async fn serve_mcp(base_url: &str) -> Result<(), String> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| format!("failed to read stdin: {e}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let message: Value = serde_json::from_str(trimmed)
            .map_err(|e| format!("failed to parse MCP JSON-RPC message: {e}"))?;
        let response = handle_mcp_request(message, base_url).await;
        if response.is_null() {
            continue;
        }
        let mut rendered = serde_json::to_string(&response)
            .map_err(|e| format!("failed to render MCP response: {e}"))?;
        rendered.push('\n');
        stdout
            .write_all(rendered.as_bytes())
            .map_err(|e| format!("failed to write stdout: {e}"))?;
        stdout
            .flush()
            .map_err(|e| format!("failed to flush stdout: {e}"))?;
    }
    Ok(())
}

fn print_json<T: Serialize>(value: &T) -> Result<(), String> {
    let rendered =
        serde_json::to_string_pretty(value).map_err(|e| format!("failed to render json: {e}"))?;
    println!("{rendered}");
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::StageComplete {
            task_id,
            status,
            summary,
            metadata,
            server_url,
        } => {
            // Validate status
            if status != "success" && status != "failure" {
                eprintln!(
                    "Error: --status must be \"success\" or \"failure\", got \"{}\"",
                    status
                );
                process::exit(1);
            }

            let metadata_value = parse_metadata_json(&metadata).unwrap_or_else(|e| {
                eprintln!("Error: {e}");
                process::exit(1);
            });

            let env_pairs = env::vars().collect::<Vec<_>>();
            let borrowed_pairs = env_pairs
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str()))
                .collect::<Vec<_>>();
            if let Some(base_url) =
                resolve_optional_server_base_url(&borrowed_pairs, server_url.as_deref())
            {
                let request = build_complete_stage_request(
                    status.clone(),
                    summary.clone(),
                    metadata_value.clone(),
                );
                if let Err(e) = complete_stage_via_api(&base_url, &task_id, &request).await {
                    eprintln!("Error: {e}");
                    process::exit(1);
                }

                match env::var("KANNA_SOCKET_PATH") {
                    Ok(socket_path) => {
                        if let Err(e) = notify_socket(&socket_path, &task_id).await {
                            eprintln!("Warning: Socket notification failed: {e}");
                        }
                    }
                    Err(_) => {
                        eprintln!(
                            "Warning: KANNA_SOCKET_PATH not set, skipping socket notification"
                        );
                    }
                }
                return;
            }

            // Build stage_result JSON
            let mut stage_result = serde_json::json!({
                "status": status,
                "summary": summary,
            });

            if let Some(meta) = metadata_value {
                stage_result["metadata"] = meta;
            }

            let stage_result_str = serde_json::to_string(&stage_result).unwrap_or_else(|e| {
                eprintln!("Error: Failed to serialize stage_result: {e}");
                process::exit(1);
            });

            // Step 1: Write to DB (critical path)
            let db_path = resolve_stage_db_path_from_env().unwrap_or_else(|e| {
                eprintln!("Error: {e}");
                process::exit(1);
            });

            if let Err(e) = write_stage_result_to_db(&db_path, &task_id, &stage_result_str) {
                eprintln!("Error: {e}");
                process::exit(1);
            }

            // Step 2: Notify via Unix socket (best-effort)
            match env::var("KANNA_SOCKET_PATH") {
                Ok(socket_path) => {
                    if let Err(e) = notify_socket(&socket_path, &task_id).await {
                        eprintln!("Warning: Socket notification failed: {e}");
                        // Best-effort — still exit 0
                    }
                }
                Err(_) => {
                    eprintln!("Warning: KANNA_SOCKET_PATH not set, skipping socket notification");
                }
            }
        }
        Commands::Repo { command } => match command {
            RepoCommands::List { server_url } => {
                let base_url = resolve_server_base_url_from_env(server_url.as_deref());
                let repos = list_repos_via_api(&base_url).await.unwrap_or_else(|e| {
                    eprintln!("Error: {e}");
                    process::exit(1);
                });
                if let Err(e) = print_json(&repos) {
                    eprintln!("Error: {e}");
                    process::exit(1);
                }
            }
        },
        Commands::Task { command } => match command {
            TaskCommands::Create {
                repo_id,
                prompt,
                server_url,
                pipeline_name,
                base_ref,
                stage,
                agent_provider,
                model,
                permission_mode,
                allowed_tool,
            } => {
                let base_url = resolve_server_base_url_from_env(server_url.as_deref());
                let request = build_create_task_request(TaskCreateOptions {
                    repo_id,
                    prompt,
                    pipeline_name,
                    base_ref,
                    stage,
                    agent_provider,
                    model,
                    permission_mode,
                    allowed_tool,
                });
                let created = create_task_via_api(&base_url, &request)
                    .await
                    .unwrap_or_else(|e| {
                        eprintln!("Error: {e}");
                        process::exit(1);
                    });
                if let Err(e) = print_json(&created) {
                    eprintln!("Error: {e}");
                    process::exit(1);
                }
            }
            TaskCommands::RequestRevision {
                task_id,
                target_stage,
                summary,
                prompt,
                metadata,
                server_url,
            } => {
                let metadata_value = parse_metadata_json(&metadata).unwrap_or_else(|e| {
                    eprintln!("Error: {e}");
                    process::exit(1);
                });
                let base_url = resolve_server_base_url_from_env(server_url.as_deref());
                let request =
                    build_request_revision_request(target_stage, summary, prompt, metadata_value);
                let created = request_revision_via_api(&base_url, &task_id, &request)
                    .await
                    .unwrap_or_else(|e| {
                        eprintln!("Error: {e}");
                        process::exit(1);
                    });
                if let Err(e) = print_json(&created) {
                    eprintln!("Error: {e}");
                    process::exit(1);
                }

                match env::var("KANNA_SOCKET_PATH") {
                    Ok(socket_path) => {
                        if let Err(e) = notify_socket(&socket_path, &task_id).await {
                            eprintln!("Warning: Socket notification failed: {e}");
                        }
                    }
                    Err(_) => {
                        eprintln!(
                            "Warning: KANNA_SOCKET_PATH not set, skipping socket notification"
                        );
                    }
                }
            }
        },
        Commands::Mcp { command } => match command {
            McpCommands::Serve { server_url } => {
                let base_url = resolve_server_base_url_from_env(server_url.as_deref());
                if let Err(e) = serve_mcp(&base_url).await {
                    eprintln!("Error: {e}");
                    process::exit(1);
                }
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_complete_stage_request, build_create_task_request, build_request_revision_request,
        handle_mcp_request,
        resolve_optional_server_base_url, resolve_server_base_url, resolve_stage_db_path,
        TaskCreateOptions,
    };
    use serde_json::json;

    #[test]
    fn prefers_cli_specific_db_path() {
        let env = [("KANNA_CLI_DB_PATH", "/tmp/worktree.db")];

        assert_eq!(
            resolve_stage_db_path(&env),
            Ok("/tmp/worktree.db".to_string())
        );
    }

    #[test]
    fn errors_when_cli_path_missing() {
        let env: [(&str, &str); 0] = [];
        assert_eq!(
            resolve_stage_db_path(&env),
            Err("KANNA_CLI_DB_PATH environment variable is not set".to_string())
        );
    }

    #[test]
    fn uses_explicit_server_url_before_env_or_default() {
        let env = [("KANNA_SERVER_BASE_URL", "http://127.0.0.1:9999")];

        assert_eq!(
            resolve_server_base_url(&env, Some("http://127.0.0.1:5555")),
            "http://127.0.0.1:5555".to_string()
        );
    }

    #[test]
    fn falls_back_to_default_local_server_url() {
        let env: [(&str, &str); 0] = [];

        assert_eq!(
            resolve_server_base_url(&env, None),
            "http://127.0.0.1:48120".to_string()
        );
    }

    #[test]
    fn optional_server_url_only_uses_explicit_or_env_values() {
        let empty_env: [(&str, &str); 0] = [];
        assert_eq!(resolve_optional_server_base_url(&empty_env, None), None);

        let env = [("KANNA_SERVER_BASE_URL", "http://127.0.0.1:48129")];
        assert_eq!(
            resolve_optional_server_base_url(&env, None),
            Some("http://127.0.0.1:48129".to_string())
        );
        assert_eq!(
            resolve_optional_server_base_url(&env, Some("http://127.0.0.1:5555")),
            Some("http://127.0.0.1:5555".to_string())
        );
    }

    #[test]
    fn builds_complete_stage_payload() {
        let request = build_complete_stage_request(
            "success".to_string(),
            "review passed".to_string(),
            Some(json!({ "coverage": "sufficient" })),
        );

        assert_eq!(
            serde_json::to_value(request).unwrap(),
            json!({
                "status": "success",
                "summary": "review passed",
                "metadata": { "coverage": "sufficient" },
            })
        );
    }

    #[test]
    fn builds_request_revision_payload() {
        let request = build_request_revision_request(
            "in progress".to_string(),
            "missing e2e coverage".to_string(),
            "Add e2e coverage for task creation.".to_string(),
            None,
        );

        assert_eq!(
            serde_json::to_value(request).unwrap(),
            json!({
                "targetStage": "in progress",
                "summary": "missing e2e coverage",
                "prompt": "Add e2e coverage for task creation.",
            })
        );
    }

    #[tokio::test]
    async fn mcp_initialize_returns_server_info() {
        let response = handle_mcp_request(
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {}
            }),
            "http://127.0.0.1:48120",
        )
        .await;

        assert_eq!(response["jsonrpc"], "2.0");
        assert_eq!(response["id"], 1);
        assert_eq!(response["result"]["serverInfo"]["name"], "kanna-cli");
        assert_eq!(response["result"]["capabilities"]["tools"], json!({}));
    }

    #[tokio::test]
    async fn mcp_tools_list_includes_task_control_tools() {
        let response = handle_mcp_request(
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list"
            }),
            "http://127.0.0.1:48120",
        )
        .await;

        let tools = response["result"]["tools"].as_array().unwrap();
        let names = tools
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect::<Vec<_>>();
        assert!(names.contains(&"complete_stage"));
        assert!(names.contains(&"request_revision"));
        assert!(names.contains(&"advance_stage"));
        assert!(names.contains(&"create_task"));
    }

    #[test]
    fn builds_camel_case_task_request_payload() {
        let request = build_create_task_request(TaskCreateOptions {
            repo_id: "repo-1".to_string(),
            prompt: "Ship it".to_string(),
            pipeline_name: Some("default".to_string()),
            base_ref: Some("origin/main".to_string()),
            stage: Some("pr".to_string()),
            agent_provider: Some("claude".to_string()),
            model: Some("sonnet".to_string()),
            permission_mode: Some("dontAsk".to_string()),
            allowed_tool: vec!["Bash".to_string(), "Edit".to_string()],
        });

        assert_eq!(
            serde_json::to_value(request).unwrap(),
            json!({
                "repoId": "repo-1",
                "prompt": "Ship it",
                "pipelineName": "default",
                "baseRef": "origin/main",
                "stage": "pr",
                "agentProvider": "claude",
                "model": "sonnet",
                "permissionMode": "dontAsk",
                "allowedTools": ["Bash", "Edit"],
            })
        );
    }
}

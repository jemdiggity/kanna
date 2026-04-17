use clap::{Parser, Subcommand};
use rusqlite::Connection;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::env;
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
        } => {
            // Validate status
            if status != "success" && status != "failure" {
                eprintln!(
                    "Error: --status must be \"success\" or \"failure\", got \"{}\"",
                    status
                );
                process::exit(1);
            }

            // Validate metadata JSON if provided
            let metadata_value: Option<Value> = match &metadata {
                Some(json_str) => match serde_json::from_str(json_str) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        eprintln!("Error: --metadata is not valid JSON: {e}");
                        process::exit(1);
                    }
                },
                None => None,
            };

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
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_create_task_request, resolve_server_base_url, resolve_stage_db_path,
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

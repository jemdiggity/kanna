use clap::{Parser, Subcommand};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::io::{BufRead, Write};
use std::process;

const DEFAULT_SERVER_BASE_URL: &str = "http://127.0.0.1:48120";

#[derive(Parser)]
#[command(name = "kanna-mcp")]
#[command(about = "Kanna MCP server")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Serve MCP over newline-delimited JSON-RPC on stdin/stdout.
    Serve {
        /// Override the local Kanna server base URL.
        #[arg(long)]
        server_url: Option<String>,
    },
}

fn main() {
    let _ = Cli::parse();
    eprintln!("not implemented");
    process::exit(1);
}

fn env_var_from_pairs(env_pairs: &[(&str, &str)], key: &str) -> Option<String> {
    env_pairs
        .iter()
        .find_map(|(candidate, value)| (*candidate == key).then(|| (*value).to_string()))
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

fn mcp_response(id: Value, result: Value) -> Value {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn mcp_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message.into() }
    })
}

fn mcp_tools() -> Value {
    serde_json::json!([
        {
            "name": "kanna_list_repos",
            "description": "List repositories known to the running Kanna desktop server.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "kanna_list_recent_tasks",
            "description": "List recent open Kanna tasks.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "kanna_search_tasks",
            "description": "Search Kanna tasks by query text.",
            "inputSchema": {
                "type": "object",
                "properties": { "query": { "type": "string" } },
                "required": ["query"]
            }
        },
        {
            "name": "kanna_list_repo_tasks",
            "description": "List Kanna tasks for a repository.",
            "inputSchema": {
                "type": "object",
                "properties": { "repo_id": { "type": "string" } },
                "required": ["repo_id"]
            }
        },
        {
            "name": "kanna_create_task",
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
        },
        {
            "name": "kanna_send_task_input",
            "description": "Send input text to a Kanna task terminal session.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "input": { "type": "string" }
                },
                "required": ["task_id", "input"]
            }
        },
        {
            "name": "kanna_close_task",
            "description": "Close a Kanna task.",
            "inputSchema": {
                "type": "object",
                "properties": { "task_id": { "type": "string" } },
                "required": ["task_id"]
            }
        },
        {
            "name": "kanna_advance_stage",
            "description": "Advance a Kanna task to the next pipeline stage.",
            "inputSchema": {
                "type": "object",
                "properties": { "task_id": { "type": "string" } },
                "required": ["task_id"]
            }
        },
        {
            "name": "kanna_complete_stage",
            "description": "Record completion for a Kanna pipeline stage.",
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
            "name": "kanna_request_revision",
            "description": "Create a revision task from an existing Kanna task branch.",
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
        }
    ])
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
                    "name": "kanna-mcp",
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

async fn handle_mcp_tool_call(_base_url: &str, name: &str, _args: Value) -> Result<Value, String> {
    Err(format!("unknown tool: {name}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolves_explicit_server_url_before_env_or_default() {
        let env = [("KANNA_SERVER_BASE_URL", "http://127.0.0.1:9999")];

        assert_eq!(
            resolve_server_base_url(&env, Some("http://127.0.0.1:5555")),
            "http://127.0.0.1:5555"
        );
    }

    #[test]
    fn resolves_env_server_url_before_default() {
        let env = [("KANNA_SERVER_BASE_URL", "http://127.0.0.1:9999")];

        assert_eq!(resolve_server_base_url(&env, None), "http://127.0.0.1:9999");
    }

    #[test]
    fn falls_back_to_default_local_server_url() {
        let env: [(&str, &str); 0] = [];

        assert_eq!(resolve_server_base_url(&env, None), DEFAULT_SERVER_BASE_URL);
    }

    #[test]
    fn tool_list_contains_prefixed_kanna_tools() {
        let tools = mcp_tools();
        let names = tools
            .as_array()
            .expect("tools array")
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "kanna_list_repos",
                "kanna_list_recent_tasks",
                "kanna_search_tasks",
                "kanna_list_repo_tasks",
                "kanna_create_task",
                "kanna_send_task_input",
                "kanna_close_task",
                "kanna_advance_stage",
                "kanna_complete_stage",
                "kanna_request_revision",
            ]
        );
    }

    #[tokio::test]
    async fn initialize_advertises_kanna_mcp_server_info() {
        let response = handle_mcp_request(
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize"
            }),
            "http://127.0.0.1:48120",
        )
        .await;

        assert_eq!(response["result"]["serverInfo"]["name"], "kanna-mcp");
        assert_eq!(response["result"]["capabilities"], json!({ "tools": {} }));
    }

    #[tokio::test]
    async fn missing_tool_name_returns_invalid_params() {
        let response = handle_mcp_request(
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {}
            }),
            "http://127.0.0.1:48120",
        )
        .await;

        assert_eq!(response["error"]["code"], -32602);
        assert_eq!(response["error"]["message"], "missing tool name");
    }
}

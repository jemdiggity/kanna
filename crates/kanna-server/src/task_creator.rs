use crate::config::Config;
use crate::daemon_client::DaemonClient;
use crate::db::{Db, NewPipelineItem, Repo};
use kanna_daemon::protocol::{
    AgentProvider as DaemonAgentProvider, Command as DaemonCommand, Event as DaemonEvent,
};
use serde::Deserialize;
use serde_yaml::Value as YamlValue;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Default, Deserialize)]
struct RepoConfig {
    pipeline: Option<String>,
    setup: Option<Vec<String>>,
    ports: Option<HashMap<String, u16>>,
}

#[derive(Deserialize)]
struct PipelineDefinition {
    stages: Vec<PipelineStage>,
}

#[derive(Deserialize)]
struct PipelineStage {
    name: String,
    agent: Option<String>,
    prompt: Option<String>,
    agent_provider: Option<String>,
    transition: Option<String>,
}

#[derive(Default, Deserialize)]
struct AgentFrontmatter {
    agent_provider: Option<YamlValue>,
    model: Option<String>,
    permission_mode: Option<String>,
    allowed_tools: Option<Vec<String>>,
}

struct AgentDefinition {
    prompt: String,
    agent_providers: Vec<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    allowed_tools: Vec<String>,
}

pub async fn run_merge_agent(
    db: &Db,
    daemon: &mut DaemonClient,
    config: &Config,
    source_task_id: &str,
) -> Result<String, String> {
    let prepared = prepare_merge_agent_for_api(db, config, source_task_id)?;
    spawn_prepared_task(daemon, prepared)
        .await
        .map(|created| created.task_id)
}

pub(crate) fn prepare_merge_agent_for_api(
    db: &Db,
    config: &Config,
    source_task_id: &str,
) -> Result<PreparedTaskSpawn, String> {
    let source_task = db
        .get_pipeline_item(source_task_id)
        .map_err(|e| format!("db error: {}", e))?
        .ok_or_else(|| format!("task not found: {}", source_task_id))?;
    let repo = db
        .get_repo(&source_task.repo_id)
        .map_err(|e| format!("db error: {}", e))?
        .ok_or_else(|| format!("repo not found for task: {}", source_task_id))?;

    let merge_agent = read_agent_definition(&repo.path, "merge")?;
    prepare_task_spawn(
        db,
        config,
        &repo,
        TaskCreationRequest {
            task_prompt: merge_agent.prompt,
            pipeline_name: None,
            base_ref: None,
            stage_override: None,
            explicit_provider: None,
            model: None,
            permission_mode: None,
            allowed_tools: Vec::new(),
        },
    )
}

pub(crate) fn prepare_advance_stage_for_api(
    db: &Db,
    config: &Config,
    source_task_id: &str,
) -> Result<PreparedTaskSpawn, String> {
    let source_task = db
        .get_task_stage_source(source_task_id)
        .map_err(|e| format!("db error: {}", e))?
        .ok_or_else(|| format!("task not found: {}", source_task_id))?;
    let repo = db
        .get_repo(&source_task.repo_id)
        .map_err(|e| format!("db error: {}", e))?
        .ok_or_else(|| format!("repo not found for task: {}", source_task_id))?;

    let pipeline_name = source_task
        .pipeline
        .clone()
        .unwrap_or_else(|| "default".to_string());
    let current_stage_name = source_task
        .stage
        .clone()
        .ok_or_else(|| format!("task has no stage: {}", source_task_id))?;
    let pipeline = read_pipeline_definition(&repo.path, &pipeline_name)?;
    let current_stage_index = pipeline
        .stages
        .iter()
        .position(|stage| stage.name == current_stage_name)
        .ok_or_else(|| format!("stage not found in pipeline: {}", current_stage_name))?;
    let next_stage = pipeline
        .stages
        .get(current_stage_index + 1)
        .ok_or_else(|| format!("task already at final stage: {}", current_stage_name))?;

    let task_prompt = build_target_stage_prompt(
        &repo.path,
        next_stage,
        source_task.prompt.as_deref().unwrap_or(""),
        source_task.stage_result.as_deref(),
        source_task.branch.as_deref(),
    )?;
    let explicit_provider = if next_stage.agent.is_some() {
        None
    } else {
        source_task.agent_provider
    };

    prepare_task_spawn(
        db,
        config,
        &repo,
        TaskCreationRequest {
            task_prompt,
            pipeline_name: Some(pipeline_name),
            base_ref: source_task.branch,
            stage_override: Some(next_stage.name.clone()),
            explicit_provider,
            model: None,
            permission_mode: None,
            allowed_tools: Vec::new(),
        },
    )
}

pub(crate) fn prepare_auto_stage_completion_for_api(
    db: &Db,
    config: &Config,
    source_task_id: &str,
) -> Result<Option<PreparedTaskSpawn>, String> {
    let source_task = db
        .get_task_stage_source(source_task_id)
        .map_err(|e| format!("db error: {}", e))?
        .ok_or_else(|| format!("task not found: {}", source_task_id))?;
    let repo = db
        .get_repo(&source_task.repo_id)
        .map_err(|e| format!("db error: {}", e))?
        .ok_or_else(|| format!("repo not found for task: {}", source_task_id))?;

    let pipeline_name = source_task
        .pipeline
        .clone()
        .unwrap_or_else(|| "default".to_string());
    let current_stage_name = source_task
        .stage
        .clone()
        .ok_or_else(|| format!("task has no stage: {}", source_task_id))?;
    let pipeline = read_pipeline_definition(&repo.path, &pipeline_name)?;
    let current_stage_index = pipeline
        .stages
        .iter()
        .position(|stage| stage.name == current_stage_name)
        .ok_or_else(|| format!("stage not found in pipeline: {}", current_stage_name))?;
    let current_stage = &pipeline.stages[current_stage_index];
    if current_stage.transition.as_deref() != Some("auto") {
        return Ok(None);
    }
    let Some(next_stage) = pipeline.stages.get(current_stage_index + 1) else {
        return Ok(None);
    };

    let task_prompt = build_target_stage_prompt(
        &repo.path,
        next_stage,
        source_task.prompt.as_deref().unwrap_or(""),
        source_task.stage_result.as_deref(),
        source_task.branch.as_deref(),
    )?;
    let explicit_provider = if next_stage.agent.is_some() {
        None
    } else {
        source_task.agent_provider
    };

    prepare_task_spawn(
        db,
        config,
        &repo,
        TaskCreationRequest {
            task_prompt,
            pipeline_name: Some(pipeline_name),
            base_ref: source_task.branch,
            stage_override: Some(next_stage.name.clone()),
            explicit_provider,
            model: None,
            permission_mode: None,
            allowed_tools: Vec::new(),
        },
    )
    .map(Some)
}

pub(crate) fn prepare_revision_task_for_api(
    db: &Db,
    config: &Config,
    source_task_id: &str,
    target_stage_name: &str,
    revision_prompt: &str,
) -> Result<PreparedTaskSpawn, String> {
    let source_task = db
        .get_task_stage_source(source_task_id)
        .map_err(|e| format!("db error: {}", e))?
        .ok_or_else(|| format!("task not found: {}", source_task_id))?;
    let repo = db
        .get_repo(&source_task.repo_id)
        .map_err(|e| format!("db error: {}", e))?
        .ok_or_else(|| format!("repo not found for task: {}", source_task_id))?;

    let pipeline_name = source_task
        .pipeline
        .clone()
        .unwrap_or_else(|| "default".to_string());
    let pipeline = read_pipeline_definition(&repo.path, &pipeline_name)?;
    let target_stage = pipeline
        .stages
        .iter()
        .find(|stage| stage.name == target_stage_name)
        .ok_or_else(|| format!("stage not found in pipeline: {}", target_stage_name))?;

    let task_prompt = build_target_stage_prompt(
        &repo.path,
        target_stage,
        revision_prompt,
        source_task.stage_result.as_deref(),
        source_task.branch.as_deref(),
    )?;
    let explicit_provider = if target_stage.agent.is_some() {
        None
    } else {
        source_task.agent_provider
    };

    prepare_task_spawn(
        db,
        config,
        &repo,
        TaskCreationRequest {
            task_prompt,
            pipeline_name: Some(pipeline_name),
            base_ref: source_task.branch,
            stage_override: Some(target_stage.name.clone()),
            explicit_provider,
            model: None,
            permission_mode: None,
            allowed_tools: Vec::new(),
        },
    )
}

struct TaskCreationRequest {
    task_prompt: String,
    pipeline_name: Option<String>,
    base_ref: Option<String>,
    stage_override: Option<String>,
    explicit_provider: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    allowed_tools: Vec<String>,
}

struct CreatedTask {
    task_id: String,
    repo_id: String,
    title: String,
    stage: String,
}

pub(crate) struct PreparedTaskSpawn {
    created_task: CreatedTask,
    session_id: String,
    executable: String,
    args: Vec<String>,
    cwd: String,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
    agent_provider: DaemonAgentProvider,
}

pub(crate) fn prepare_task_for_api(
    db: &Db,
    config: &Config,
    request: crate::mobile_api::CreateTaskRequest,
) -> Result<PreparedTaskSpawn, String> {
    let repo = db
        .get_repo(&request.repo_id)
        .map_err(|e| format!("db error: {}", e))?
        .ok_or_else(|| format!("repo not found: {}", request.repo_id))?;

    prepare_task_spawn(
        db,
        config,
        &repo,
        TaskCreationRequest {
            task_prompt: request.prompt.clone(),
            pipeline_name: request.pipeline_name,
            base_ref: request.base_ref,
            stage_override: request.stage,
            explicit_provider: request.agent_provider,
            model: request.model,
            permission_mode: request.permission_mode,
            allowed_tools: request.allowed_tools.unwrap_or_default(),
        },
    )
}

fn prepare_task_spawn(
    db: &Db,
    config: &Config,
    repo: &Repo,
    request: TaskCreationRequest,
) -> Result<PreparedTaskSpawn, String> {
    let original_prompt = request.task_prompt.clone();
    let repo_config = read_repo_config(&repo.path)?;
    let pipeline_name = request
        .pipeline_name
        .or(repo_config.pipeline.clone())
        .unwrap_or_else(|| "default".to_string());
    let pipeline = read_pipeline_definition(&repo.path, &pipeline_name)?;
    let stage = if let Some(stage_name) = request.stage_override.as_deref() {
        pipeline
            .stages
            .iter()
            .find(|stage| stage.name == stage_name)
            .ok_or_else(|| format!("stage not found in pipeline: {}", stage_name))?
    } else {
        pipeline
            .stages
            .first()
            .ok_or_else(|| format!("pipeline has no stages: {}", pipeline_name))?
    };

    let agent = if let Some(agent_name) = stage.agent.as_deref() {
        Some(read_agent_definition(&repo.path, agent_name)?)
    } else {
        None
    };

    let final_prompt = if request.stage_override.is_some() {
        original_prompt.clone()
    } else {
        build_stage_prompt(
            agent
                .as_ref()
                .map(|agent| agent.prompt.as_str())
                .unwrap_or(""),
            stage.prompt.as_deref(),
            &PromptContext {
                task_prompt: Some(&request.task_prompt),
                prev_result: None,
                branch: request.base_ref.as_deref(),
            },
        )
    };

    let provider = resolve_agent_provider(
        request
            .explicit_provider
            .as_deref()
            .or(stage.agent_provider.as_deref()),
        agent.as_ref(),
    )?;
    let model = request
        .model
        .or_else(|| agent.as_ref().and_then(|agent| agent.model.clone()));
    let permission_mode = request.permission_mode.or_else(|| {
        agent
            .as_ref()
            .and_then(|agent| agent.permission_mode.clone())
    });
    let allowed_tools = if request.allowed_tools.is_empty() {
        agent
            .as_ref()
            .map(|agent| agent.allowed_tools.clone())
            .unwrap_or_default()
    } else {
        request.allowed_tools
    };

    let task_id = generate_task_id()?;
    let branch = format!("task-{}", task_id);
    let worktree_path = format!("{}/.kanna-worktrees/{}", repo.path, branch);
    let stage_name = request
        .stage_override
        .as_deref()
        .unwrap_or(stage.name.as_str())
        .to_string();
    let tags_json = serde_json::to_string(&vec![stage_name.clone()])
        .map_err(|e| format!("serialize error: {}", e))?;

    db.insert_pipeline_item(NewPipelineItem {
        id: &task_id,
        repo_id: &repo.id,
        prompt: &original_prompt,
        pipeline: &pipeline_name,
        stage: &stage_name,
        tags_json: &tags_json,
        branch: &branch,
        agent_type: "pty",
        agent_provider: provider.as_str(),
        activity: "working",
        port_offset: None,
        port_env_json: None,
        base_ref: request.base_ref.as_deref(),
    })
    .map_err(|e| format!("db error: {}", e))?;

    let port_env = claim_task_ports(db, &task_id, repo_config.ports.as_ref())?;
    let first_port = port_env
        .values()
        .next()
        .and_then(|value| value.parse::<i64>().ok());
    let port_env_json = if port_env.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&port_env).map_err(|e| format!("serialize error: {}", e))?)
    };
    db.update_pipeline_item_ports(&task_id, first_port, port_env_json.as_deref())
        .map_err(|e| format!("db error: {}", e))?;

    let start_point = request
        .base_ref
        .clone()
        .or_else(|| fetch_start_point(&repo.path, repo.default_branch.as_deref()));
    create_worktree(&repo.path, &branch, &worktree_path, start_point.as_deref())?;
    let worktree_repo_config = read_repo_config(&worktree_path)?;
    let spawn_env = build_spawn_env(config, &task_id, &port_env)?;
    let agent_cmd = build_agent_command(
        &provider,
        &final_prompt,
        model.as_deref(),
        permission_mode.as_deref(),
        &allowed_tools,
    );
    let full_cmd = build_task_shell_command(
        &agent_cmd,
        worktree_repo_config.setup.as_deref().unwrap_or(&[]),
        spawn_env.get("KANNA_CLI_PATH").map(String::as_str),
    );

    Ok(PreparedTaskSpawn {
        created_task: CreatedTask {
            task_id: task_id.clone(),
            repo_id: repo.id.clone(),
            title: original_prompt,
            stage: stage_name,
        },
        session_id: task_id,
        executable: "/bin/zsh".to_string(),
        args: vec![
            "--login".to_string(),
            "-i".to_string(),
            "-c".to_string(),
            full_cmd,
        ],
        cwd: worktree_path,
        env: spawn_env,
        cols: 80,
        rows: 24,
        agent_provider: provider.to_daemon_provider(),
    })
}

async fn spawn_prepared_task(
    daemon: &mut DaemonClient,
    prepared: PreparedTaskSpawn,
) -> Result<CreatedTask, String> {
    let event = daemon
        .send_command(&DaemonCommand::Spawn {
            session_id: prepared.session_id,
            executable: prepared.executable,
            args: prepared.args,
            cwd: prepared.cwd,
            env: prepared.env,
            cols: prepared.cols,
            rows: prepared.rows,
            agent_provider: Some(prepared.agent_provider),
        })
        .await
        .map_err(|e| format!("daemon error: {}", e))?;

    match event {
        DaemonEvent::SessionCreated { .. } => Ok(prepared.created_task),
        DaemonEvent::Error { message, .. } => Err(format!("daemon error: {}", message)),
        other => Err(format!("unexpected daemon response: {:?}", other)),
    }
}

pub(crate) async fn spawn_prepared_task_for_api(
    daemon: &mut DaemonClient,
    prepared: PreparedTaskSpawn,
) -> Result<crate::mobile_api::CreateTaskResponse, String> {
    let created = spawn_prepared_task(daemon, prepared).await?;
    Ok(crate::mobile_api::CreateTaskResponse {
        task_id: created.task_id,
        repo_id: created.repo_id,
        title: created.title,
        stage: created.stage,
    })
}

fn read_repo_config(repo_path: &str) -> Result<RepoConfig, String> {
    let path = Path::new(repo_path).join(".kanna/config.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|e| format!("invalid repo config: {}", e))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(RepoConfig::default()),
        Err(err) => Err(format!("failed to read repo config: {}", err)),
    }
}

fn read_pipeline_definition(
    repo_path: &str,
    pipeline_name: &str,
) -> Result<PipelineDefinition, String> {
    let path = Path::new(repo_path).join(format!(".kanna/pipelines/{pipeline_name}.json"));
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => read_builtin_resource(&format!(".kanna/pipelines/{pipeline_name}.json"))?,
    };
    serde_json::from_str(&content).map_err(|e| format!("invalid pipeline definition: {}", e))
}

fn read_agent_definition(repo_path: &str, agent_name: &str) -> Result<AgentDefinition, String> {
    let path = Path::new(repo_path).join(format!(".kanna/agents/{agent_name}/AGENT.md"));
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => read_builtin_resource(&format!(".kanna/agents/{agent_name}/AGENT.md"))?,
    };
    parse_agent_definition(&content)
}

fn build_target_stage_prompt(
    repo_path: &str,
    stage: &PipelineStage,
    task_prompt: &str,
    prev_result: Option<&str>,
    branch: Option<&str>,
) -> Result<String, String> {
    if let Some(agent_name) = stage.agent.as_deref() {
        let agent = read_agent_definition(repo_path, agent_name)?;
        return Ok(build_stage_prompt(
            &agent.prompt,
            stage.prompt.as_deref(),
            &PromptContext {
                task_prompt: Some(task_prompt),
                prev_result,
                branch,
            },
        ));
    }

    Ok(task_prompt.to_string())
}

fn read_builtin_resource(relative_path: &str) -> Result<String, String> {
    let mut dir = std::env::current_dir().map_err(|e| format!("failed to read cwd: {}", e))?;
    for _ in 0..10 {
        let candidate = dir.join(relative_path);
        if candidate.exists() {
            return std::fs::read_to_string(&candidate)
                .map_err(|e| format!("failed to read builtin resource: {}", e));
        }
        if !dir.pop() {
            break;
        }
    }
    Err(format!("resource not found: {}", relative_path))
}

fn parse_agent_definition(content: &str) -> Result<AgentDefinition, String> {
    let (frontmatter, body) = split_frontmatter(content);
    let fm: AgentFrontmatter = match frontmatter {
        Some(raw) => {
            serde_yaml::from_str(raw).map_err(|e| format!("invalid AGENT.md frontmatter: {}", e))?
        }
        None => AgentFrontmatter::default(),
    };

    Ok(AgentDefinition {
        prompt: body.trim().to_string(),
        agent_providers: parse_agent_providers(fm.agent_provider),
        model: fm.model,
        permission_mode: fm.permission_mode,
        allowed_tools: fm.allowed_tools.unwrap_or_default(),
    })
}

fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    let normalized = content.trim_start_matches('\u{feff}');
    let Some(rest) = normalized.strip_prefix("---") else {
        return (None, normalized);
    };
    let Some(rest) = rest
        .strip_prefix('\n')
        .or_else(|| rest.strip_prefix("\r\n"))
    else {
        return (None, normalized);
    };
    if let Some(index) = rest.find("\n---\n") {
        let frontmatter = &rest[..index];
        let body = &rest[index + 5..];
        return (Some(frontmatter), body);
    }
    if let Some(index) = rest.find("\r\n---\r\n") {
        let frontmatter = &rest[..index];
        let body = &rest[index + 7..];
        return (Some(frontmatter), body);
    }
    (None, normalized)
}

fn parse_agent_providers(value: Option<YamlValue>) -> Vec<String> {
    match value {
        Some(YamlValue::Sequence(values)) => values
            .into_iter()
            .filter_map(|value| value.as_str().map(str::to_string))
            .collect(),
        Some(YamlValue::String(value)) => value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

struct PromptContext<'a> {
    task_prompt: Option<&'a str>,
    prev_result: Option<&'a str>,
    branch: Option<&'a str>,
}

fn build_stage_prompt(
    agent_prompt: &str,
    stage_prompt: Option<&str>,
    context: &PromptContext<'_>,
) -> String {
    let mut parts = Vec::new();
    if !agent_prompt.trim().is_empty() {
        parts.push(agent_prompt.trim());
    }
    if let Some(stage_prompt) = stage_prompt {
        if !stage_prompt.trim().is_empty() {
            parts.push(stage_prompt.trim());
        }
    }

    parts
        .join("\n\n")
        .replace("$TASK_PROMPT", context.task_prompt.unwrap_or(""))
        .replace("$PREV_RESULT", context.prev_result.unwrap_or(""))
        .replace("$BRANCH", context.branch.unwrap_or(""))
}

#[derive(Clone, Copy)]
enum AgentProvider {
    Claude,
    Copilot,
    Codex,
}

impl AgentProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Copilot => "copilot",
            Self::Codex => "codex",
        }
    }

    fn to_daemon_provider(self) -> DaemonAgentProvider {
        match self {
            Self::Claude => DaemonAgentProvider::Claude,
            Self::Copilot => DaemonAgentProvider::Copilot,
            Self::Codex => DaemonAgentProvider::Codex,
        }
    }
}

fn resolve_agent_provider(
    stage_provider: Option<&str>,
    agent: Option<&AgentDefinition>,
) -> Result<AgentProvider, String> {
    let mut candidates = Vec::new();
    if let Some(stage_provider) = stage_provider {
        candidates.extend(
            stage_provider
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        );
    }
    if candidates.is_empty() {
        candidates.extend(
            agent
                .map(|agent| agent.agent_providers.clone())
                .unwrap_or_default(),
        );
    }

    let parsed = candidates
        .iter()
        .filter_map(|candidate| match candidate.as_str() {
            "claude" => Some(AgentProvider::Claude),
            "copilot" => Some(AgentProvider::Copilot),
            "codex" => Some(AgentProvider::Codex),
            _ => None,
        })
        .collect::<Vec<_>>();
    if parsed.is_empty() {
        return Err("no agent provider configured for task creation".to_string());
    }

    for provider in &parsed {
        if binary_available(provider.as_str()) {
            return Ok(*provider);
        }
    }

    Ok(parsed[0])
}

fn binary_available(name: &str) -> bool {
    Command::new("/bin/zsh")
        .args([
            "--login",
            "-i",
            "-c",
            &format!("command -v {} >/dev/null 2>&1", name),
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn generate_task_id() -> Result<String, String> {
    let mut bytes = [0u8; 4];
    File::open("/dev/urandom")
        .map_err(|e| format!("failed to open /dev/urandom: {}", e))?
        .read_exact(&mut bytes)
        .map_err(|e| format!("failed to read random bytes: {}", e))?;
    Ok(bytes.iter().map(|byte| format!("{:02x}", byte)).collect())
}

fn fetch_start_point(repo_path: &str, default_branch: Option<&str>) -> Option<String> {
    let branch = default_branch.unwrap_or("main");
    let status = Command::new("git")
        .args(["fetch", "origin", branch])
        .current_dir(repo_path)
        .status()
        .ok()?;
    if status.success() {
        Some(format!("origin/{}", branch))
    } else {
        None
    }
}

fn create_worktree(
    repo_path: &str,
    branch: &str,
    worktree_path: &str,
    start_point: Option<&str>,
) -> Result<(), String> {
    let branch_exists = Command::new("git")
        .args([
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{}", branch),
        ])
        .current_dir(repo_path)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);

    let mut args = vec!["worktree", "add"];
    if branch_exists {
        args.push(worktree_path);
        args.push(branch);
    } else {
        args.push("-b");
        args.push(branch);
        args.push(worktree_path);
        if let Some(start_point) = start_point {
            args.push(start_point);
        }
    }

    let output = Command::new("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("failed to run git worktree add: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let cargo_dir = Path::new(worktree_path).join(".cargo");
    let _ = std::fs::create_dir_all(&cargo_dir);
    let _ = std::fs::write(
        cargo_dir.join("config.toml"),
        "[build]\ntarget-dir = \".build\"\n",
    );
    Ok(())
}

fn claim_task_ports(
    db: &Db,
    item_id: &str,
    ports: Option<&HashMap<String, u16>>,
) -> Result<HashMap<String, String>, String> {
    let Some(ports) = ports else {
        return Ok(HashMap::new());
    };

    let mut claimed = db
        .list_task_ports()
        .map_err(|e| format!("db error: {}", e))?
        .into_iter()
        .collect::<HashSet<_>>();
    let existing = db
        .list_task_ports_for_item(item_id)
        .map_err(|e| format!("db error: {}", e))?;
    let mut port_env = HashMap::new();

    for (env_name, preferred) in ports {
        if let Some(existing_port) = existing.get(env_name) {
            claimed.insert(*existing_port);
            port_env.insert(env_name.clone(), existing_port.to_string());
            continue;
        }

        let mut candidate = i64::from(*preferred) + 1;
        loop {
            if !claimed.contains(&candidate)
                && db
                    .claim_task_port(item_id, env_name, candidate)
                    .map_err(|e| format!("db error: {}", e))?
            {
                claimed.insert(candidate);
                port_env.insert(env_name.clone(), candidate.to_string());
                break;
            }
            candidate += 1;
            if candidate > 65535 {
                return Err(format!("no free port available near {}", preferred));
            }
        }
    }

    Ok(port_env)
}

fn build_spawn_env(
    config: &Config,
    task_id: &str,
    port_env: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    let mut env = HashMap::from([
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
        ("TERM_PROGRAM".to_string(), "kanna".to_string()),
        ("KANNA_WORKTREE".to_string(), "1".to_string()),
        ("KANNA_TASK_ID".to_string(), task_id.to_string()),
        ("KANNA_CLI_DB_PATH".to_string(), config.db_path.clone()),
        (
            "KANNA_SOCKET_PATH".to_string(),
            pipeline_socket_path(&config.daemon_dir),
        ),
        (
            "KANNA_SERVER_BASE_URL".to_string(),
            format!("http://127.0.0.1:{}", config.lan_port),
        ),
    ]);
    env.extend(port_env.clone());
    if let Some(path) = which_binary("kanna-cli")? {
        env.insert("KANNA_CLI_PATH".to_string(), path);
    }
    Ok(env)
}

fn which_binary(name: &str) -> Result<Option<String>, String> {
    let output = Command::new("/bin/zsh")
        .args(["--login", "-i", "-c", &format!("command -v {}", name)])
        .output()
        .map_err(|e| format!("failed to locate {}: {}", name, e))?;
    if !output.status.success() {
        return Ok(None);
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path))
    }
}

fn build_agent_command(
    provider: &AgentProvider,
    prompt: &str,
    model: Option<&str>,
    permission_mode: Option<&str>,
    allowed_tools: &[String],
) -> String {
    let escaped_prompt = shell_single_quote(prompt);
    match provider {
        AgentProvider::Claude => {
            let mut flags = get_agent_permission_flags(*provider, permission_mode);
            if let Some(model) = model {
                flags.push(format!("--model {}", model));
            }
            if !allowed_tools.is_empty() {
                flags.push(format!("--allowedTools {}", allowed_tools.join(",")));
            }
            format!("claude {} '{}'", flags.join(" "), escaped_prompt)
        }
        AgentProvider::Copilot => {
            let mut flags = get_agent_permission_flags(*provider, permission_mode);
            if let Some(model) = model {
                flags.push(format!("--model={}", model));
            }
            if !allowed_tools.is_empty() {
                for tool in allowed_tools {
                    flags.push(format!("--allow-tool={}", tool));
                }
            }
            format!("copilot {} -i '{}'", flags.join(" "), escaped_prompt)
        }
        AgentProvider::Codex => {
            let mut flags = get_agent_permission_flags(*provider, permission_mode);
            if let Some(model) = model {
                flags.push(format!("-m {}", model));
            }
            format!("codex {} '{}'", flags.join(" "), escaped_prompt)
        }
    }
}

fn get_agent_permission_flags(
    provider: AgentProvider,
    permission_mode: Option<&str>,
) -> Vec<String> {
    let normalized = match permission_mode {
        Some("default") | None => None,
        other => other,
    };

    match provider {
        AgentProvider::Claude => match normalized {
            None | Some("dontAsk") => vec!["--dangerously-skip-permissions".to_string()],
            Some(mode) => vec![format!("--permission-mode {}", mode)],
        },
        AgentProvider::Copilot => vec!["--yolo".to_string()],
        AgentProvider::Codex => match normalized {
            None | Some("dontAsk") => vec!["--yolo".to_string()],
            Some(_) => vec!["--full-auto".to_string()],
        },
    }
}

fn build_task_shell_command(
    agent_cmd: &str,
    setup_cmds: &[String],
    kanna_cli_path: Option<&str>,
) -> String {
    let mut command_parts = Vec::new();
    if let Some(kanna_cli_path) = kanna_cli_path {
        let quoted = shell_single_quote(kanna_cli_path);
        command_parts.push(format!("export KANNA_CLI_PATH='{}'", quoted));
        if let Some(parent) = Path::new(kanna_cli_path).parent() {
            let parent = shell_single_quote(parent.to_string_lossy().as_ref());
            command_parts.push(format!("export PATH='{}':\"$PATH\"", parent));
        }
    }

    if !setup_cmds.is_empty() {
        let setup_parts = setup_cmds
            .iter()
            .map(|cmd| {
                format!(
                    "printf '\\033[2m$ %s\\033[0m\\n' '{}' && {}",
                    shell_single_quote(cmd),
                    cmd
                )
            })
            .collect::<Vec<_>>()
            .join(" && ");
        command_parts.push(format!(
            "printf '\\033[33mRunning startup...\\033[0m\\n' && {} && printf '\\n'",
            setup_parts
        ));
    }

    command_parts.push(agent_cmd.to_string());
    command_parts.join(" && ")
}

fn shell_single_quote(value: &str) -> String {
    value.replace('\'', "'\\''")
}

fn pipeline_socket_path(daemon_dir: &str) -> String {
    let dir = PathBuf::from(daemon_dir).join("pipeline");
    short_socket_path(&dir).to_string_lossy().to_string()
}

fn short_socket_path(dir: &PathBuf) -> PathBuf {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    dir.hash(&mut hasher);
    let hash = hasher.finish() as u32;
    PathBuf::from(format!("/tmp/kanna-{:08x}.sock", hash))
}

#[cfg(test)]
mod tests {
    use super::{prepare_advance_stage_for_api, prepare_revision_task_for_api};
    use crate::config::Config;
    use crate::db::Db;
    use std::process::Command;

    #[test]
    fn prepare_advance_stage_builds_next_stage_task_from_previous_branch() {
        let repo_root =
            std::env::temp_dir().join(format!("kanna-stage-advance-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&repo_root);
        std::fs::create_dir_all(repo_root.join(".kanna/pipelines")).unwrap();
        std::fs::create_dir_all(repo_root.join(".kanna/agents/reviewer")).unwrap();
        std::fs::write(repo_root.join("README.md"), "test repo").unwrap();
        assert!(Command::new("git")
            .arg("init")
            .arg("-b")
            .arg("main")
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["add", "README.md", ".kanna"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        std::fs::write(
            repo_root.join(".kanna/pipelines/default.json"),
            r#"{
  "stages": [
    { "name": "in progress", "transition": "manual" },
    { "name": "pr", "transition": "manual", "agent": "reviewer", "prompt": "Review branch $BRANCH with result $PREV_RESULT" }
  ]
}"#,
        )
        .unwrap();
        std::fs::write(
            repo_root.join(".kanna/agents/reviewer/AGENT.md"),
            "---\nagent_provider: claude\n---\nReview task: $TASK_PROMPT",
        )
        .unwrap();
        assert!(Command::new("git")
            .args(["add", ".kanna"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["commit", "-m", "add kanna config"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["branch", "task-old-branch"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());

        let config = Config {
            relay_url: "wss://relay.example".to_string(),
            device_token: "device-token".to_string(),
            cloud_base_url: "http://127.0.0.1:5001/kanna-local/us-central1".to_string(),
            firebase_project_id: "kanna-local".to_string(),
            firebase_auth_emulator_url: Some("http://127.0.0.1:9099".to_string()),
            firebase_firestore_emulator_host: Some("127.0.0.1:8080".to_string()),
            daemon_dir: "/tmp/kanna-daemon".to_string(),
            db_path: Db::test_db_path("advance-stage-helper"),
            desktop_id: "desktop-1".to_string(),
            desktop_secret: Some("desktop-secret".to_string()),
            desktop_name: "Studio Mac".to_string(),
            lan_host: "0.0.0.0".to_string(),
            lan_port: 48120,
            pairing_store_path: "/tmp/kanna-pairings.json".to_string(),
        };
        let db = Db::open_for_tests(&config.db_path).unwrap();
        db.insert_test_repo_with_path("repo-1", &repo_root.to_string_lossy(), "Repo One")
            .unwrap();
        db.insert_test_pipeline_item(
            "task-1",
            "repo-1",
            "Fix the mobile shell",
            Some("Mobile shell"),
            "in progress",
            "2026-04-17 07:00:00",
        )
        .unwrap();
        db.update_test_pipeline_item_stage_context(
            "task-1",
            "task-old-branch",
            "default",
            Some("{\"status\":\"success\"}"),
            "copilot",
        )
        .unwrap();

        let prepared = prepare_advance_stage_for_api(&db, &config, "task-1").unwrap();

        assert_eq!(prepared.created_task.repo_id, "repo-1");
        assert_eq!(prepared.created_task.stage, "pr");
        assert_eq!(
            prepared.created_task.title,
            "Review task: Fix the mobile shell\n\nReview branch task-old-branch with result {\"status\":\"success\"}"
        );
        assert!(prepared.cwd.contains(".kanna-worktrees/task-"));
    }

    #[test]
    fn prepare_revision_task_builds_target_stage_task_from_reviewed_branch() {
        let repo_root =
            std::env::temp_dir().join(format!("kanna-stage-revision-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&repo_root);
        std::fs::create_dir_all(repo_root.join(".kanna/pipelines")).unwrap();
        std::fs::create_dir_all(repo_root.join(".kanna/agents/implement")).unwrap();
        std::fs::write(repo_root.join("README.md"), "test repo").unwrap();
        assert!(Command::new("git")
            .arg("init")
            .arg("-b")
            .arg("main")
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        std::fs::write(
            repo_root.join(".kanna/pipelines/qa.json"),
            r#"{
  "stages": [
    { "name": "in progress", "transition": "manual", "agent": "implement", "prompt": "$TASK_PROMPT" },
    { "name": "review", "transition": "auto" },
    { "name": "pr", "transition": "manual" }
  ]
}"#,
        )
        .unwrap();
        std::fs::write(
            repo_root.join(".kanna/agents/implement/AGENT.md"),
            "---\nagent_provider: claude\n---\nImplement revision:\n$TASK_PROMPT",
        )
        .unwrap();
        assert!(Command::new("git")
            .args(["add", "README.md", ".kanna"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["branch", "task-reviewed-branch"])
            .current_dir(&repo_root)
            .status()
            .unwrap()
            .success());

        let config = Config {
            relay_url: "wss://relay.example".to_string(),
            device_token: "device-token".to_string(),
            cloud_base_url: "http://127.0.0.1:5001/kanna-local/us-central1".to_string(),
            firebase_project_id: "kanna-local".to_string(),
            firebase_auth_emulator_url: Some("http://127.0.0.1:9099".to_string()),
            firebase_firestore_emulator_host: Some("127.0.0.1:8080".to_string()),
            daemon_dir: "/tmp/kanna-daemon".to_string(),
            db_path: Db::test_db_path("revision-stage-helper"),
            desktop_id: "desktop-1".to_string(),
            desktop_secret: Some("desktop-secret".to_string()),
            desktop_name: "Studio Mac".to_string(),
            lan_host: "0.0.0.0".to_string(),
            lan_port: 48120,
            pairing_store_path: "/tmp/kanna-pairings.json".to_string(),
        };
        let db = Db::open_for_tests(&config.db_path).unwrap();
        db.insert_test_repo_with_path("repo-1", &repo_root.to_string_lossy(), "Repo One")
            .unwrap();
        db.insert_test_pipeline_item(
            "review-task",
            "repo-1",
            "Fix the mobile shell",
            Some("Mobile shell"),
            "review",
            "2026-04-17 07:00:00",
        )
        .unwrap();
        db.update_test_pipeline_item_stage_context(
            "review-task",
            "task-reviewed-branch",
            "qa",
            Some("{\"status\":\"failure\",\"summary\":\"missing e2e\"}"),
            "copilot",
        )
        .unwrap();

        let prepared = prepare_revision_task_for_api(
            &db,
            &config,
            "review-task",
            "in progress",
            "Add e2e coverage for task creation.",
        )
        .unwrap();

        assert_eq!(prepared.created_task.repo_id, "repo-1");
        assert_eq!(prepared.created_task.stage, "in progress");
        assert_eq!(
            prepared.created_task.title,
            "Implement revision:\nAdd e2e coverage for task creation.\n\nAdd e2e coverage for task creation."
        );
        assert!(prepared.cwd.contains(".kanna-worktrees/task-"));
    }
}

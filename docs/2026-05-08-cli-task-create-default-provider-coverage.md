# CLI task create default provider coverage

Full desktop E2E coverage for `kanna-cli task create` default provider resolution is not currently practical in the cargo test layer because it requires a running Tauri desktop instance, a real Kanna daemon, a prepared SQLite app database, git worktree creation, and installed agent CLIs. The narrower coverage added for this behavior keeps the boundary explicit:

- `crates/kanna-cli` verifies an omitted `--agent-provider` flag serializes the create-task payload without `agentProvider`, allowing the server to resolve the setting.
- `crates/kanna-server` verifies `/v1/tasks` reads `settings.defaultAgentProvider`, persists `pipeline_item.agent_provider`, prepares the git worktree task, and sends the resolved provider in the daemon `Spawn` command when the HTTP payload omits the provider.

A full desktop E2E would become feasible once the desktop E2E harness can start or fake the local HTTP server and daemon together while invoking the compiled `kanna-cli` binary against the active test app database.

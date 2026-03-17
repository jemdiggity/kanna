//! # claude-agent-sdk
//!
//! A Rust crate that wraps the Claude Code CLI binary, communicating via
//! structured NDJSON over stdin/stdout.
//!
//! ## Quick Start
//!
//! ```rust,no_run
//! use claude_agent_sdk::{Session, SessionOptions, PermissionMode};
//!
//! # async fn example() -> Result<(), claude_agent_sdk::Error> {
//! let session = Session::start(
//!     SessionOptions::builder()
//!         .cwd("/path/to/project")
//!         .model("claude-sonnet-4-6")
//!         .permission_mode(PermissionMode::AcceptEdits)
//!         .allowed_tools(vec!["Read", "Edit", "Bash"])
//!         .build(),
//!     "Fix the failing tests",
//! ).await?;
//!
//! while let Some(msg) = session.next_message().await {
//!     match msg? {
//!         claude_agent_sdk::Message::Result(r) => {
//!             println!("Done. Cost: ${:.4}", r.total_cost_usd());
//!             break;
//!         }
//!         _ => {}
//!     }
//! }
//!
//! session.close().await;
//! # Ok(())
//! # }
//! ```

pub mod error;
pub mod session;
pub mod types;

// Re-export primary types for convenience.
pub use error::Error;
pub use session::{find_claude_binary, PermissionCallback, Session};
pub use types::control::{
    ControlRequest, ControlRequestEnvelope, ControlResponse, ControlResponseEnvelope,
};
pub use types::messages::{
    AssistantMessage, AuthStatusMessage, ContentBlock, Message, PromptSuggestionMessage,
    RateLimitMessage, ResultMessage, StreamEventMessage, SystemMessage, ToolProgressMessage,
    Usage, UserInput, UserMessage,
};
pub use types::options::{Effort, SessionOptions, SessionOptionsBuilder, ThinkingMode};
pub use types::permissions::{PermissionMode, PermissionResult};

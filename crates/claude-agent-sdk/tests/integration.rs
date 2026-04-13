/// Integration tests for the Claude Agent SDK.
///
/// These tests require a working `claude` binary in PATH and valid authentication.
/// They are ignored by default — run with `cargo test -- --ignored` to execute.
use claude_agent_sdk::{Message, Session, SessionOptions};

#[tokio::test]
#[ignore] // Requires live Claude CLI
async fn test_simple_prompt_returns_messages() {
    let session = Session::start(
        SessionOptions::builder().max_turns(1).build(),
        "Respond with exactly: HELLO_SDK_TEST",
    )
    .await
    .expect("Failed to start session");

    let mut got_assistant = false;
    let mut got_result = false;
    let mut message_count = 0;

    loop {
        match session.next_message().await {
            Some(Ok(msg)) => {
                message_count += 1;
                eprintln!(
                    "[test] Message #{}: type={:?}",
                    message_count,
                    msg_type(&msg)
                );

                match &msg {
                    Message::Assistant(_) => got_assistant = true,
                    Message::Result(_) => {
                        got_result = true;
                        break;
                    }
                    _ => {}
                }
            }
            Some(Err(e)) => {
                panic!("Error receiving message: {}", e);
            }
            None => {
                eprintln!("[test] Stream ended after {} messages", message_count);
                break;
            }
        }
    }

    session.close().await;

    assert!(message_count > 0, "Expected at least one message, got none");
    assert!(got_assistant, "Expected at least one assistant message");
    assert!(got_result, "Expected a result message");
}

#[tokio::test]
#[ignore]
async fn test_session_with_cwd() {
    let session = Session::start(
        SessionOptions::builder().cwd("/tmp").max_turns(1).build(),
        "What directory are you in? Reply with just the path.",
    )
    .await
    .expect("Failed to start session");

    let mut messages = Vec::new();
    loop {
        match session.next_message().await {
            Some(Ok(msg)) => {
                messages.push(msg);
                if matches!(messages.last(), Some(Message::Result(_))) {
                    break;
                }
            }
            Some(Err(e)) => panic!("Error: {}", e),
            None => break,
        }
    }

    session.close().await;
    assert!(!messages.is_empty(), "Expected messages");
}

#[tokio::test]
#[ignore]
async fn test_message_stream_not_empty_before_result() {
    // Verifies that we receive streaming messages BEFORE the final result
    let session = Session::start(SessionOptions::builder().max_turns(1).build(), "Say hello")
        .await
        .expect("Failed to start session");

    let mut pre_result_count = 0;
    loop {
        match session.next_message().await {
            Some(Ok(Message::Result(_))) => break,
            Some(Ok(_)) => pre_result_count += 1,
            Some(Err(e)) => panic!("Error: {}", e),
            None => break,
        }
    }

    session.close().await;

    assert!(
        pre_result_count > 0,
        "Expected messages before result, got {} total pre-result messages",
        pre_result_count
    );
}

#[tokio::test]
#[ignore]
async fn test_debug_raw_cli_output() {
    // Bypass the SDK — run Claude CLI directly and print every line of stdout
    let binary = claude_agent_sdk::find_claude_binary().expect("Claude not found");
    eprintln!("[debug] Using binary: {:?}", binary);

    // Exactly: claude -p "prompt" --output-format stream-json --verbose
    let mut child = tokio::process::Command::new(&binary)
        .args([
            "-p",
            "Respond with exactly one word: HELLO",
            "--output-format",
            "stream-json",
            "--verbose",
            "--max-turns",
            "1",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("Failed to spawn");

    // Read stdout line by line with a timeout per line
    use tokio::io::{AsyncBufReadExt, BufReader};
    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut line_count = 0;
    while let Ok(result) =
        tokio::time::timeout(std::time::Duration::from_secs(60), lines.next_line()).await
    {
        let Some(line) = result.unwrap() else { break };
        line_count += 1;
        // Parse just the "type" field
        let type_str = serde_json::from_str::<serde_json::Value>(&line)
            .ok()
            .and_then(|v| {
                v.get("type")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or("???".to_string());
        eprintln!(
            "[debug] Line {}: type={}, len={}",
            line_count,
            type_str,
            line.len()
        );

        // Print first 200 chars of each line
        let preview = if line.len() > 200 {
            &line[..200]
        } else {
            &line
        };
        eprintln!("  > {}", preview);
    }

    let status = child.wait().await.unwrap();
    let stderr_out = {
        let mut buf = Vec::new();
        if let Some(mut stderr) = child.stderr.take() {
            use tokio::io::AsyncReadExt;
            let _ = stderr.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).to_string()
    };

    eprintln!("[debug] Exit status: {:?}", status);
    eprintln!("[debug] Total lines: {}", line_count);
    if !stderr_out.is_empty() {
        eprintln!("[debug] STDERR: {}", stderr_out);
    }
}

fn msg_type(msg: &Message) -> &'static str {
    match msg {
        Message::Assistant(_) => "assistant",
        Message::User(_) => "user",
        Message::Result(_) => "result",
        Message::System(_) => "system",
        Message::StreamEvent(_) => "stream_event",
        Message::ToolProgress(_) => "tool_progress",
        Message::AuthStatus(_) => "auth_status",
        Message::RateLimit(_) => "rate_limit",
        Message::PromptSuggestion(_) => "prompt_suggestion",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BenchmarkProvider {
    Codex,
    Claude,
    Copilot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BenchmarkMode {
    Steady,
    WorstCase,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimedChunk {
    pub at_ms: u64,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transcript {
    pub provider: BenchmarkProvider,
    pub mode: BenchmarkMode,
    pub total_duration_ms: u64,
    pub chunks: Vec<TimedChunk>,
}

impl Transcript {
    pub fn status_check_points_ms(&self, throttle_ms: u64) -> Vec<u64> {
        let mut next_check_at = 0;
        let mut checks = Vec::new();

        for chunk in &self.chunks {
            if chunk.at_ms >= next_check_at {
                checks.push(chunk.at_ms);
                next_check_at = chunk.at_ms + throttle_ms;
            }
        }

        checks
    }
}

#[derive(Debug, Clone, Copy)]
pub struct TranscriptSpec {
    provider: BenchmarkProvider,
    mode: BenchmarkMode,
}

impl TranscriptSpec {
    pub fn new(provider: BenchmarkProvider, mode: BenchmarkMode) -> Self {
        Self { provider, mode }
    }

    pub fn build(self) -> Transcript {
        let chunks = match self.provider {
            BenchmarkProvider::Codex => codex_chunks(self.mode),
            BenchmarkProvider::Claude => claude_chunks(self.mode),
            BenchmarkProvider::Copilot => copilot_chunks(self.mode),
        };
        let total_duration_ms = chunks.last().map(|chunk| chunk.at_ms).unwrap_or(0);

        Transcript {
            provider: self.provider,
            mode: self.mode,
            total_duration_ms,
            chunks,
        }
    }
}

fn line_frame(lines: &[&str]) -> Vec<u8> {
    let mut frame = Vec::new();
    frame.extend_from_slice(b"\x1b[2J\x1b[H");
    for line in lines {
        frame.extend_from_slice(line.as_bytes());
        frame.extend_from_slice(b"\r\n");
    }
    frame
}

fn timed_lines(at_ms: u64, lines: &[&str]) -> TimedChunk {
    TimedChunk {
        at_ms,
        bytes: line_frame(lines),
    }
}

fn codex_chunks(mode: BenchmarkMode) -> Vec<TimedChunk> {
    let mut chunks = vec![
        timed_lines(0, &["Codex", "Connecting...", ""]),
        timed_lines(
            140,
            &[
                "Codex",
                "Planning edits",
                "Thinking.",
                "• Working (0s • esc to interrupt)",
            ],
        ),
        timed_lines(
            300,
            &[
                "Codex",
                "Planning edits",
                "Thinking..",
                "• Working (0s • esc to interrupt)",
            ],
        ),
        timed_lines(
            460,
            &[
                "Codex",
                "Planning edits",
                "Thinking...",
                "• Working (0s • esc to interrupt)",
            ],
        ),
        timed_lines(
            820,
            &["Codex", "Ready for next instruction", "› review the diff"],
        ),
    ];

    if matches!(mode, BenchmarkMode::WorstCase) {
        chunks.splice(
            3..3,
            [
                timed_lines(
                    540,
                    &[
                        "Codex",
                        "Planning edits",
                        "Thinking....",
                        "• Working (0s • esc to interrupt)",
                    ],
                ),
                timed_lines(
                    660,
                    &[
                        "Codex",
                        "Planning edits",
                        "Thinking.....",
                        "• Working (0s • esc to interrupt)",
                    ],
                ),
                timed_lines(
                    780,
                    &[
                        "Codex",
                        "Planning edits",
                        "Thinking......",
                        "• Working (0s • esc to interrupt)",
                    ],
                ),
            ],
        );
        chunks.push(timed_lines(
            1_020,
            &[
                "Codex",
                "Reviewing files",
                "Thinking...",
                "• Working (0s • esc to interrupt)",
            ],
        ));
        chunks.push(timed_lines(
            1_200,
            &["Codex", "Ready for next instruction", "› review the diff"],
        ));
    }

    chunks
}

fn claude_chunks(mode: BenchmarkMode) -> Vec<TimedChunk> {
    let steady_frames = ['✻', '✽', '✶'];
    let worst_frames = ['✻', '✽', '✶', '✳', '✢', '⏺'];
    let frames = if matches!(mode, BenchmarkMode::WorstCase) {
        &worst_frames[..]
    } else {
        &steady_frames[..]
    };

    let mut chunks = frames
        .iter()
        .enumerate()
        .map(|(index, frame)| {
            timed_lines(
                (index as u64) * 160,
                &[
                    "Claude",
                    "Drafting response",
                    &frame.to_string(),
                    "• Working (0s • esc to interrupt)",
                ],
            )
        })
        .collect::<Vec<_>>();

    chunks.push(timed_lines(
        if matches!(mode, BenchmarkMode::WorstCase) {
            1_120
        } else {
            620
        },
        &["Claude", "Ready", "❯ continue"],
    ));

    chunks
}

fn copilot_chunks(mode: BenchmarkMode) -> Vec<TimedChunk> {
    let steady_lines = ["thinking", "thinking.", "thinking.."];
    let worst_lines = [
        "thinking",
        "thinking.",
        "thinking..",
        "thinking...",
        "thinking....",
    ];
    let lines = if matches!(mode, BenchmarkMode::WorstCase) {
        &worst_lines[..]
    } else {
        &steady_lines[..]
    };

    let mut chunks = lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            timed_lines(
                (index as u64) * 140,
                &["Copilot", "workspace: /tmp/demo", line, "esc to cancel"],
            )
        })
        .collect::<Vec<_>>();

    chunks.push(timed_lines(
        if matches!(mode, BenchmarkMode::WorstCase) {
            860
        } else {
            520
        },
        &["Copilot", "workspace: /tmp/demo", "❯"],
    ));

    chunks
}

#[cfg(test)]
mod tests {
    use super::{BenchmarkMode, BenchmarkProvider, TranscriptSpec};

    #[test]
    fn codex_steady_transcript_is_deterministic() {
        let first = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::Steady).build();
        let second = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::Steady).build();

        assert_eq!(first, second);
        assert!(!first.chunks.is_empty());
    }

    #[test]
    fn worst_case_emits_more_or_equal_chunks_than_steady() {
        let steady = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::Steady).build();
        let worst = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::WorstCase).build();

        assert!(worst.chunks.len() >= steady.chunks.len());
        assert!(
            worst.total_duration_ms >= steady.total_duration_ms,
            "worst-case transcript should be at least as chatty over time"
        );
    }

    #[test]
    fn all_provider_modes_emit_visible_status_markers() {
        for provider in [
            BenchmarkProvider::Codex,
            BenchmarkProvider::Claude,
            BenchmarkProvider::Copilot,
        ] {
            for mode in [BenchmarkMode::Steady, BenchmarkMode::WorstCase] {
                let transcript = TranscriptSpec::new(provider, mode).build();
                let joined = transcript
                    .chunks
                    .iter()
                    .flat_map(|chunk| chunk.bytes.iter().copied())
                    .collect::<Vec<u8>>();
                let text = String::from_utf8_lossy(&joined).to_lowercase();

                assert!(
                    text.contains("thinking")
                        || text.contains("esc to interrupt")
                        || text.contains("esc to cancel")
                        || text.contains("›")
                        || text.contains("❯"),
                    "provider transcript should include recognizable status UI"
                );
            }
        }
    }

    #[test]
    fn status_check_schedule_respects_five_hundred_ms_throttle() {
        let transcript =
            TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::WorstCase).build();
        let ticks = transcript.status_check_points_ms(500);

        assert!(!ticks.is_empty());
        assert!(ticks.windows(2).all(|pair| pair[1] - pair[0] >= 500));
    }
}

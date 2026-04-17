use kanna_terminal_recovery::bench::transcript::{
    BenchmarkMode, BenchmarkProvider, TranscriptSpec,
};

#[test]
fn benchmark_transcripts_are_deterministic_and_chatty() {
    let first = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::Steady).build();
    let second = TranscriptSpec::new(BenchmarkProvider::Codex, BenchmarkMode::Steady).build();

    assert_eq!(first, second);
    assert!(first.chunks.len() >= 4);

    let text = first
        .chunks
        .iter()
        .flat_map(|chunk| chunk.bytes.iter().copied())
        .collect::<Vec<u8>>();
    let text = String::from_utf8_lossy(&text).to_lowercase();

    assert!(text.contains("thinking") || text.contains("esc to interrupt"));
}

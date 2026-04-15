use libghostty_vt::build_info::{optimize_mode, OptimizeMode};

#[test]
fn release_build_uses_optimized_ghostty_mode() {
    if cfg!(debug_assertions) {
        return;
    }

    let mode = optimize_mode().expect("ghostty optimize mode should be readable");
    assert!(
        matches!(mode, OptimizeMode::ReleaseFast | OptimizeMode::ReleaseSmall),
        "expected optimized Ghostty release build, got {:?}",
        mode
    );
}

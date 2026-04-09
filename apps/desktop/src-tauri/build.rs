fn main() {
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        std::env::set_current_dir(&manifest_dir)
            .unwrap_or_else(|error| panic!("failed to chdir to {manifest_dir}: {error}"));
    }

    // Embed VERSION file content so lib.rs can use it for the About dialog
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let version_file = root.join("VERSION");
    if version_file.exists() {
        let version = std::fs::read_to_string(&version_file)
            .unwrap_or_default()
            .trim()
            .to_string();
        println!("cargo:rustc-env=KANNA_VERSION={}", version);
    } else {
        println!("cargo:rustc-env=KANNA_VERSION=unknown");
    }
    println!("cargo:rerun-if-changed={}", version_file.display());

    let build_branch = std::env::var("KANNA_BUILD_BRANCH").unwrap_or_default();
    let build_commit = std::env::var("KANNA_BUILD_COMMIT").unwrap_or_default();
    let build_worktree = std::env::var("KANNA_BUILD_WORKTREE").unwrap_or_default();
    println!("cargo:rustc-env=KANNA_BUILD_BRANCH={}", build_branch);
    println!("cargo:rustc-env=KANNA_BUILD_COMMIT={}", build_commit);
    println!("cargo:rustc-env=KANNA_BUILD_WORKTREE={}", build_worktree);
    let build_info = if build_branch.is_empty() {
        String::new()
    } else if build_worktree.is_empty() {
        format!("{} @ {}", build_branch, build_commit)
    } else {
        format!("{} · {} @ {}", build_worktree, build_branch, build_commit)
    };
    println!("cargo:rustc-env=KANNA_BUILD_INFO={}", build_info);
    println!("cargo:rerun-if-env-changed=KANNA_BUILD_BRANCH");
    println!("cargo:rerun-if-env-changed=KANNA_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=KANNA_BUILD_WORKTREE");

    if let Err(error) = tauri_build::try_build(Default::default()) {
        let cwd = std::env::current_dir().ok();
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").ok();
        let diagnostics = [
            ("Cargo.toml", std::path::Path::new("Cargo.toml").exists()),
            ("Info.plist", std::path::Path::new("Info.plist").exists()),
            ("icons", std::path::Path::new("icons").exists()),
            (
                "capabilities",
                std::path::Path::new("capabilities").exists(),
            ),
            ("../dist", std::path::Path::new("../dist").exists()),
            ("binaries", std::path::Path::new("binaries").exists()),
            (
                "../../../.kanna",
                std::path::Path::new("../../../.kanna").exists(),
            ),
        ];
        panic!(
            "tauri_build failed: {error:#}\ncwd={cwd:?}\nCARGO_MANIFEST_DIR={manifest_dir:?}\npath_diagnostics={diagnostics:?}"
        );
    }
}

use std::process::Command;
use std::path::PathBuf;

fn git(args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn main() {
    let commit = git(&["rev-parse", "--short", "HEAD"]);
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"]);

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .map(PathBuf::from)
        .expect("daemon crate should live under <repo>/crates/daemon");
    let version_file = repo_root.join("VERSION");

    // Version from repo VERSION file, fallback to latest git tag (strip leading 'v').
    let version = if version_file.exists() {
        std::fs::read_to_string(&version_file)
            .unwrap_or_default()
            .trim()
            .to_string()
    } else {
        let tag = git(&["describe", "--tags", "--abbrev=0"]);
        if tag == "unknown" || tag.is_empty() {
            "0.0.0".to_string()
        } else {
            tag.strip_prefix('v').unwrap_or(&tag).to_string()
        }
    };

    println!("cargo:rustc-env=KANNA_VERSION={}", version);
    println!("cargo:rustc-env=GIT_COMMIT={}", commit);
    println!("cargo:rustc-env=GIT_BRANCH={}", branch);
    println!("cargo:rerun-if-changed={}", version_file.display());
}

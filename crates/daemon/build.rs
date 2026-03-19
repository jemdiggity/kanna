use std::process::Command;

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

    // Read version from root VERSION file (single source of truth)
    let root = git(&["rev-parse", "--show-toplevel"]);
    let version_path = format!("{}/VERSION", root);
    let version = std::fs::read_to_string(&version_path)
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "0.0.0".to_string());
    // Re-run build script if VERSION changes
    println!("cargo:rerun-if-changed={}", version_path);

    println!("cargo:rustc-env=KANNA_VERSION={}", version);
    println!("cargo:rustc-env=GIT_COMMIT={}", commit);
    println!("cargo:rustc-env=GIT_BRANCH={}", branch);
}

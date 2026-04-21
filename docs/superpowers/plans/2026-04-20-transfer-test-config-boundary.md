# Transfer Test Config Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove process-global transfer env mutation from desktop Rust tests while preserving runtime transfer-root behavior.

**Architecture:** Keep env lookup at the production boundary, but move transfer identity and sidecar env construction behind explicit-root helpers. Tests will target the explicit helpers directly, so no transfer test needs `setenv`, `unsetenv`, or `std::env::set_var`.

**Tech Stack:** Rust, Tauri desktop app, cargo test

---

### Task 1: Refactor Transfer Identity To Accept Explicit Roots

**Files:**
- Modify: `apps/desktop/src-tauri/src/transfer_identity.rs`
- Test: `apps/desktop/src-tauri/src/transfer_identity.rs`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `#[cfg(test)] mod tests` block in `apps/desktop/src-tauri/src/transfer_identity.rs`:

```rust
    #[test]
    fn loads_existing_transfer_identity_from_explicit_root() {
        let temp = TestTempDir::new();
        let transfer_root = temp.path().join("explicit-transfer-root");
        let path = transfer_identity_path_for_root(&transfer_root);
        std::fs::create_dir_all(path.parent().expect("identity path should have parent"))
            .expect("identity directory should be created");
        std::fs::write(
            &path,
            r#"{
  "peer_id": "peer-stable",
  "nickname": "Desk"
}"#,
        )
        .expect("identity record should be written");

        let identity = load_or_create_transfer_identity_for_root(&transfer_root)
            .expect("existing transfer identity should load");

        assert_eq!(identity.peer_id, "peer-stable");
        assert_eq!(identity.nickname.as_deref(), Some("Desk"));
    }

    #[test]
    fn creates_and_persists_transfer_identity_under_explicit_root() {
        let temp = TestTempDir::new();
        let transfer_root = temp.path().join("explicit-transfer-root");

        let identity = load_or_create_transfer_identity_for_root(&transfer_root)
            .expect("missing transfer identity should be created");

        assert!(!identity.peer_id.is_empty());
        assert!(transfer_identity_path_for_root(&transfer_root).exists());
        assert!(!temp.path().join("transfer").join("identity.json").exists());
    }
```

- [ ] **Step 2: Run the focused transfer identity tests to verify they fail**

Run: `cd apps/desktop/src-tauri && cargo test transfer_identity::tests:: -- --nocapture`

Expected: FAIL because `transfer_identity_path_for_root` and `load_or_create_transfer_identity_for_root` do not exist yet.

- [ ] **Step 3: Write the minimal explicit-root implementation**

Update `apps/desktop/src-tauri/src/transfer_identity.rs` so the identity path and load/create logic have explicit-root helpers, while the existing env-aware functions remain as thin wrappers:

```rust
pub(crate) fn resolve_transfer_root_with_override(
    app_data_dir: &Path,
    override_root: Option<&Path>,
) -> PathBuf {
    override_root
        .map(Path::to_path_buf)
        .unwrap_or_else(|| app_data_dir.join("transfer"))
}

pub(crate) fn resolve_transfer_root(app_data_dir: &Path) -> PathBuf {
    let override_root = std::env::var("KANNA_TRANSFER_ROOT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);
    resolve_transfer_root_with_override(app_data_dir, override_root.as_deref())
}

pub(crate) fn transfer_identity_path_for_root(transfer_root: &Path) -> PathBuf {
    transfer_root.join("identity.json")
}

pub(crate) fn transfer_identity_path(app_data_dir: &Path) -> PathBuf {
    transfer_identity_path_for_root(&resolve_transfer_root(app_data_dir))
}

pub(crate) fn load_or_create_transfer_identity_for_root(
    transfer_root: &Path,
) -> Result<TransferIdentityRecord, String> {
    let path = transfer_identity_path_for_root(transfer_root);
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str::<TransferIdentityRecord>(&contents).map_err(|error| {
            format!(
                "failed to parse transfer identity '{}': {}",
                path.display(),
                error
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let identity = TransferIdentityRecord {
                peer_id: generate_peer_id(),
                nickname: None,
            };
            write_transfer_identity(&path, &identity)?;
            Ok(identity)
        }
        Err(error) => Err(format!(
            "failed to read transfer identity '{}': {}",
            path.display(),
            error
        )),
    }
}

pub(crate) fn load_or_create_transfer_identity(
    app_data_dir: &Path,
) -> Result<TransferIdentityRecord, String> {
    load_or_create_transfer_identity_for_root(&resolve_transfer_root(app_data_dir))
}

pub(crate) fn resolve_transfer_identity(
    app_data_dir: &Path,
    machine_name: Option<&str>,
) -> Result<ResolvedTransferIdentity, String> {
    resolve_transfer_identity_for_root(&resolve_transfer_root(app_data_dir), machine_name)
}

pub(crate) fn resolve_transfer_identity_for_root(
    transfer_root: &Path,
    machine_name: Option<&str>,
) -> Result<ResolvedTransferIdentity, String> {
    let identity = load_or_create_transfer_identity_for_root(transfer_root)?;
    Ok(ResolvedTransferIdentity {
        peer_id: identity.peer_id.clone(),
        display_name: resolve_transfer_display_name(&identity, machine_name),
    })
}
```

Then update the existing identity tests to call the explicit-root helpers instead of relying on the default `app_data_dir/transfer` path.

- [ ] **Step 4: Run the focused transfer identity tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test transfer_identity::tests:: -- --nocapture`

Expected: PASS

- [ ] **Step 5: Commit the transfer identity boundary refactor**

```bash
git add apps/desktop/src-tauri/src/transfer_identity.rs
git commit -m "refactor: add explicit transfer root helpers"
```

### Task 2: Build Sidecar Env From Explicit Roots And Remove Env Mutation Tests

**Files:**
- Modify: `apps/desktop/src-tauri/src/transfer_sidecar.rs`
- Test: `apps/desktop/src-tauri/src/transfer_sidecar.rs`

- [ ] **Step 1: Write the failing sidecar env test**

Replace the existing env-mutation test with this explicit-root test in `apps/desktop/src-tauri/src/transfer_sidecar.rs`:

```rust
    #[test]
    fn transfer_sidecar_env_uses_explicit_transfer_root() {
        let temp = TestTempDir::new();
        let transfer_root = temp.path().join("worktree-transfer-root");

        let env = build_transfer_sidecar_env_for_root(
            temp.path(),
            &transfer_root,
            Some("Jeremy's MacBook Pro"),
        )
        .expect("sidecar env should be built");

        assert_eq!(
            env.get("KANNA_TRANSFER_ROOT").map(String::as_str),
            Some(
                transfer_root
                    .to_str()
                    .expect("transfer root should be utf-8"),
            )
        );
        assert_eq!(
            env.get("KANNA_TRANSFER_REGISTRY_DIR").map(String::as_str),
            Some(
                transfer_root
                    .join("registry")
                    .to_str()
                    .expect("registry path should be utf-8"),
            )
        );
        assert!(transfer_root.join("identity.json").exists());
        assert!(!temp.path().join("transfer").join("identity.json").exists());
    }
```

- [ ] **Step 2: Run the focused sidecar tests to verify they fail**

Run: `cd apps/desktop/src-tauri && cargo test transfer_sidecar::tests:: -- --nocapture`

Expected: FAIL because `build_transfer_sidecar_env_for_root` does not exist yet.

- [ ] **Step 3: Write the minimal sidecar env implementation**

Update `apps/desktop/src-tauri/src/transfer_sidecar.rs` so the env-building logic is shared by a new explicit-root helper and the existing wrapper just resolves the production root before delegating:

```rust
fn build_transfer_sidecar_env(
    app_data_dir: &std::path::Path,
    machine_name: Option<&str>,
) -> Result<HashMap<String, String>, String> {
    let transfer_root = crate::transfer_identity::resolve_transfer_root(app_data_dir);
    build_transfer_sidecar_env_for_root(app_data_dir, &transfer_root, machine_name)
}

fn build_transfer_sidecar_env_for_root(
    _app_data_dir: &std::path::Path,
    transfer_root: &std::path::Path,
    machine_name: Option<&str>,
) -> Result<HashMap<String, String>, String> {
    let resolved =
        crate::transfer_identity::resolve_transfer_identity_for_root(transfer_root, machine_name)?;
    let mut env = HashMap::new();
    env.insert(
        "KANNA_TRANSFER_PORT".to_string(),
        std::env::var("KANNA_TRANSFER_PORT").unwrap_or_else(|_| "4455".to_string()),
    );
    env.insert(
        "KANNA_TRANSFER_ROOT".to_string(),
        transfer_root.to_string_lossy().into_owned(),
    );
    env.insert(
        "KANNA_TRANSFER_REGISTRY_DIR".to_string(),
        std::env::var("KANNA_TRANSFER_REGISTRY_DIR")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| transfer_root.join("registry").to_string_lossy().into_owned()),
    );
    env.insert("KANNA_TRANSFER_PEER_ID".to_string(), resolved.peer_id);
    env.insert(
        "KANNA_TRANSFER_DISPLAY_NAME".to_string(),
        resolved.display_name,
    );
    Ok(env)
}
```

Then delete the test-only env lock plus the `set_env_var` and `unset_env_var` helpers, because no sidecar test should mutate env anymore.

- [ ] **Step 4: Run the full Rust test suite to verify the race is gone**

Run: `cd apps/desktop/src-tauri && cargo test`

Expected: PASS under the default parallel runner

- [ ] **Step 5: Commit the sidecar env boundary cleanup**

```bash
git add apps/desktop/src-tauri/src/transfer_sidecar.rs
git commit -m "test: remove transfer env mutation from rust tests"
```

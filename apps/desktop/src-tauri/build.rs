use std::fs;
use std::path::{Path, PathBuf};

fn copy_tree(source: &Path, destination: &Path) {
    if source.is_dir() {
        fs::create_dir_all(destination).unwrap_or_else(|error| {
            panic!(
                "failed to create destination directory {}: {error}",
                destination.display()
            )
        });
        for entry in fs::read_dir(source).unwrap_or_else(|error| {
            panic!("failed to read source directory {}: {error}", source.display())
        }) {
            let entry = entry.unwrap_or_else(|error| {
                panic!("failed to read entry from {}: {error}", source.display())
            });
            copy_tree(&entry.path(), &destination.join(entry.file_name()));
        }
        return;
    }

    let parent = destination.parent().expect("destination must have a parent");
    fs::create_dir_all(parent).unwrap_or_else(|error| {
        panic!(
            "failed to create destination parent {}: {error}",
            parent.display()
        )
    });
    fs::copy(source, destination).unwrap_or_else(|error| {
        panic!(
            "failed to copy {} to {}: {error}",
            source.display(),
            destination.display()
        )
    });
}

fn copy_bazel_out_dir(bazel_out_dir: &Path, out_dir: &Path) {
    for entry in fs::read_dir(bazel_out_dir).unwrap_or_else(|error| {
        panic!(
            "failed to read Bazel out dir {}: {error}",
            bazel_out_dir.display()
        )
    }) {
        let entry = entry.unwrap_or_else(|error| {
            panic!(
                "failed to read entry from Bazel out dir {}: {error}",
                bazel_out_dir.display()
            )
        });
        let path = entry.path();
        if path.file_name().and_then(|name| name.to_str()) == Some("tauri-build-context.rs") {
            continue;
        }

        let destination = out_dir.join(entry.file_name());
        copy_tree(&path, &destination);
    }
}

fn is_dev_enabled(dep_tauri_dev: Option<&str>) -> bool {
    dep_tauri_dev == Some("true")
}

fn android_package_names(identifier: &str) -> (String, String) {
    let segments: Vec<_> = identifier.split('.').collect();
    let (app_name_segment, prefix_segments) = segments
        .split_last()
        .expect("identifier must contain at least one segment");

    let app_name = app_name_segment.replace('-', "_");
    let prefix = prefix_segments
        .iter()
        .map(|segment| segment.replace(['_', '-'], "_1"))
        .collect::<Vec<_>>()
        .join("_");

    (app_name, prefix)
}

fn emit_upstream_contract(out_dir: &Path) {
    let config: serde_json::Value =
        serde_json::from_str(&fs::read_to_string("tauri.conf.json").expect("failed to read tauri.conf.json"))
            .expect("failed to parse tauri.conf.json");
    let identifier = config["identifier"]
        .as_str()
        .expect("tauri.conf.json must contain identifier");
    let (android_package_name_app_name, android_package_name_prefix) =
        android_package_names(identifier);
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").expect("missing CARGO_CFG_TARGET_OS");
    let mobile = target_os == "ios" || target_os == "android";

    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-check-cfg=cfg(mobile)");
    if mobile {
        println!("cargo:rustc-cfg=mobile");
    } else {
        println!("cargo:rustc-cfg=desktop");
    }
    println!("cargo:rustc-check-cfg=cfg(dev)");
    if is_dev_enabled(std::env::var("DEP_TAURI_DEV").ok().as_deref()) {
        println!("cargo:rustc-cfg=dev");
    }
    println!(
        "cargo:rustc-env=TAURI_ANDROID_PACKAGE_NAME_APP_NAME={}",
        android_package_name_app_name
    );
    println!(
        "cargo:rustc-env=TAURI_ANDROID_PACKAGE_NAME_PREFIX={}",
        android_package_name_prefix
    );
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=TAURI_ENV_TARGET_TRIPLE={target}");
    }
    println!(
        "cargo:PERMISSION_FILES_PATH={}",
        out_dir
            .join("app-manifest")
            .join("__app__-permission-files")
            .display()
    );
}

fn extract_quoted_name_after(text: &str, marker: &str) -> Option<String> {
    let start = text.find(marker)? + marker.len();
    let end = text[start..].find('"')?;
    Some(text[start..start + end].to_string())
}

fn first_icon_path<F>(predicate: F) -> Option<PathBuf>
where
    F: Fn(&str) -> bool,
{
    let config: serde_json::Value =
        serde_json::from_str(&fs::read_to_string("tauri.conf.json").expect("failed to read tauri.conf.json"))
            .expect("failed to parse tauri.conf.json");
    let icons = config["bundle"]["icon"]
        .as_array()
        .expect("tauri.conf.json must contain bundle.icon");
    icons
        .iter()
        .filter_map(|value| value.as_str())
        .find(|path| predicate(path))
        .map(PathBuf::from)
}

fn decode_png_to_rgba(path: &Path) -> Vec<u8> {
    let data = fs::read(path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    let decoder = png::Decoder::new(std::io::Cursor::new(data));
    let mut reader = decoder
        .read_info()
        .unwrap_or_else(|error| panic!("failed to decode {}: {error}", path.display()));
    let mut rgba = Vec::with_capacity(reader.output_buffer_size());
    while let Ok(Some(row)) = reader.next_row() {
        rgba.extend_from_slice(row.data());
    }
    rgba
}

fn strip_generated_icon_embedding(context: String) -> String {
    let package_info_marker = ", :: tauri :: PackageInfo {";
    let icon_marker = ", :: std :: option :: Option :: Some (:: tauri :: image :: Image :: new (";

    let Some(icon_start) = context.find(icon_marker) else {
        return context;
    };
    let Some(package_info_start) = context[icon_start..].find(package_info_marker) else {
        return context;
    };
    let package_info_start = icon_start + package_info_start;

    let mut rewritten = String::with_capacity(context.len());
    rewritten.push_str(&context[..icon_start]);
    rewritten.push_str(", :: std :: option :: Option :: None , :: std :: option :: Option :: None ");
    rewritten.push_str(&context[package_info_start..]);
    rewritten
}

fn normalize_plugin_acl_keys(mut context: String) -> String {
    for (raw, normalized) in [
        ("plugin-opener", "opener"),
        ("plugin-shell", "shell"),
        ("plugin-sql", "sql"),
        ("plugin-dialog", "dialog"),
        ("plugin-webdriver", "webdriver"),
    ] {
        context = context.replace(
            &format!("\"plugin:{raw}|"),
            &format!("\"plugin:{normalized}|"),
        );
        context = context.replace(
            &format!("\"{raw}\" . into ()"),
            &format!("\"{normalized}\" . into ()"),
        );
    }

    context
}

fn ensure_generated_support_files(out_dir: &Path, context_path: &Path) {
    let context = fs::read_to_string(context_path).unwrap_or_else(|error| {
        panic!(
            "failed to read generated context {}: {error}",
            context_path.display()
        )
    });

    let plist_marker =
        "embed_info_plist ! (:: std :: concat ! (:: std :: env ! (\"OUT_DIR\") , \"/\" , \"";
    if let Some(file_name) = extract_quoted_name_after(&context, plist_marker) {
        let path = out_dir.join(file_name);
        if !path.exists() {
            let package_name = std::env::var("CARGO_PKG_NAME").expect("missing CARGO_PKG_NAME");
            let package_version =
                std::env::var("CARGO_PKG_VERSION").expect("missing CARGO_PKG_VERSION");
            let plist = format!(
                concat!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
                    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" ",
                    "\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n",
                    "<plist version=\"1.0\">\n",
                    "<dict>\n",
                    "\t<key>CFBundleName</key>\n",
                    "\t<string>{}</string>\n",
                    "\t<key>CFBundleShortVersionString</key>\n",
                    "\t<string>{}</string>\n",
                    "\t<key>CFBundleVersion</key>\n",
                    "\t<string>{}</string>\n",
                    "</dict>\n",
                    "</plist>\n"
                ),
                package_name,
                package_version,
                package_version,
            );
            fs::write(&path, plist)
                .unwrap_or_else(|error| panic!("failed to write {}: {error}", path.display()));
        }
    }

    let include_bytes_marker =
        "include_bytes ! (:: std :: concat ! (:: std :: env ! (\"OUT_DIR\") , \"/\" , \"";
    let mut search = context.as_str();
    let mut missing_raw_targets = Vec::new();
    let mut missing_rgba_targets = Vec::new();
    while let Some(offset) = search.find(include_bytes_marker) {
        let remainder = &search[offset + include_bytes_marker.len()..];
        let Some(end) = remainder.find('"') else {
            break;
        };
        let candidate = &remainder[..end];
        if !out_dir.join(candidate).exists() {
            if remainder[end..].contains(". to_vec ())") {
                missing_raw_targets.push(candidate.to_string());
            } else {
                missing_rgba_targets.push(candidate.to_string());
            }
        }
        search = &remainder[end..];
    }

    if let Some(raw_icon_path) = first_icon_path(|path| path.ends_with(".icns")) {
        for file_name in missing_raw_targets {
            let destination = out_dir.join(file_name);
            fs::copy(&raw_icon_path, &destination).unwrap_or_else(|error| {
                panic!(
                    "failed to copy {} to {}: {error}",
                    raw_icon_path.display(),
                    destination.display()
                )
            });
        }
    }

    if !missing_rgba_targets.is_empty() {
        let png_icon_path =
            first_icon_path(|path| path.ends_with(".png")).expect("failed to locate .png icon");
        let rgba_icon = decode_png_to_rgba(&png_icon_path);
        for file_name in missing_rgba_targets {
            let destination = out_dir.join(file_name);
            fs::write(&destination, &rgba_icon).unwrap_or_else(|error| {
                panic!("failed to write {}: {error}", destination.display())
            });
        }
    }
}

fn emit_kanna_version_metadata() {
    let version = std::env::var("KANNA_VERSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var("KANNA_VERSION_FILE")
                .ok()
                .and_then(|path| std::fs::read_to_string(path).ok())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    println!("cargo:rustc-env=KANNA_VERSION={version}");
    println!("cargo:rerun-if-env-changed=KANNA_VERSION");
    println!("cargo:rerun-if-env-changed=KANNA_VERSION_FILE");

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
}

fn main() {
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        std::env::set_current_dir(&manifest_dir)
            .unwrap_or_else(|error| panic!("failed to chdir to {manifest_dir}: {error}"));
    }

    emit_kanna_version_metadata();

    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rerun-if-env-changed=REMOVE_UNUSED_COMMANDS");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed=../dist");

    let full_context_path = std::env::var("RULES_TAURI_BAZEL_FULL_CONTEXT")
        .expect("kanna release builds require Bazel-provided RULES_TAURI_BAZEL_FULL_CONTEXT");
    println!("cargo:rerun-if-env-changed=RULES_TAURI_BAZEL_FULL_CONTEXT");
    println!("cargo:rerun-if-changed={full_context_path}");
    let acl_out_dir = PathBuf::from(
        std::env::var("RULES_TAURI_BAZEL_ACL_OUT_DIR")
            .expect("kanna release builds require Bazel-provided RULES_TAURI_BAZEL_ACL_OUT_DIR"),
    );
    println!("cargo:rerun-if-env-changed=RULES_TAURI_BAZEL_ACL_OUT_DIR");
    println!("cargo:rerun-if-changed={}", acl_out_dir.display());

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("missing OUT_DIR"));
    let out_path = out_dir.join("tauri-build-context.rs");
    let full_context = fs::read_to_string(&full_context_path).unwrap_or_else(|error| {
        panic!(
            "failed to read {}: {error}",
            full_context_path,
        )
    });
    let full_context = normalize_plugin_acl_keys(strip_generated_icon_embedding(full_context));
    fs::write(&out_path, full_context).unwrap_or_else(|error| {
        panic!(
            "failed to write {}: {error}",
            out_path.display()
        )
    });

    copy_bazel_out_dir(&acl_out_dir, &out_dir);
    ensure_generated_support_files(&out_dir, &out_path);
    emit_upstream_contract(&out_dir);
}

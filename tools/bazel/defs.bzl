def _files_from_target(target):
    return target[DefaultInfo].files.to_list()

def _files_from_targets(targets):
    files = []
    for target in targets:
        files.extend(_files_from_target(target))
    return files

def _write_source_manifest(ctx, files, output):
    entries = []
    for file in files:
        entries.append({
            "dest": file.short_path,
            "source": file.path,
        })
    ctx.actions.write(output = output, content = json.encode(entries))

def _write_tool_manifest(ctx, files, output):
    entries = []
    for file in files:
        entries.append({
            "source": file.path,
        })
    ctx.actions.write(output = output, content = json.encode(entries))

def _write_stage_manifest(ctx, staged_inputs, output):
    entries = []
    inputs = []
    for target, destination in staged_inputs.items():
        files = _files_from_target(target)
        if len(files) != 1:
            fail("staged input %s must provide exactly one file" % target.label)
        file = files[0]
        entries.append({
            "dest": destination,
            "source": file.path,
        })
        inputs.append(file)
    ctx.actions.write(output = output, content = json.encode(entries))
    return inputs

def _bun_vite_dist_impl(ctx):
    out_dir = ctx.actions.declare_directory(ctx.label.name)
    src_files = _files_from_targets(ctx.attr.srcs)
    tool = ctx.file._tool
    bun = ctx.file._bun
    source_manifest = ctx.actions.declare_file(ctx.label.name + "_srcs.json")

    _write_source_manifest(ctx, src_files, source_manifest)

    ctx.actions.run_shell(
        inputs = depset(direct = src_files + [tool, source_manifest, bun]),
        outputs = [out_dir],
        command = """
set -euo pipefail
python3 "$1" --source-manifest "$2" --package-dir "$3" --out-dir "$4" --bun "$5"
""",
        arguments = [
            tool.path,
            source_manifest.path,
            ctx.attr.package_dir,
            out_dir.path,
            bun.path,
        ],
        mnemonic = "KannaBunViteDist",
        progress_message = "Building frontend dist for %s" % ctx.label.name,
        use_default_shell_env = True,
    )

    return [DefaultInfo(files = depset([out_dir]))]

def _cargo_binary_impl(ctx):
    output = ctx.actions.declare_file(ctx.attr.output_name)
    src_files = _files_from_targets(ctx.attr.srcs)
    tool = ctx.file._tool
    cargo = ctx.file.cargo_tool
    rustc = ctx.file.rustc_tool
    rustc_lib_files = ctx.attr.rustc_libs[DefaultInfo].files.to_list()
    host_rust_std_files = ctx.attr.host_rust_std[DefaultInfo].files.to_list()
    target_rust_std_files = []
    if ctx.attr.target_rust_std:
        target_rust_std_files = ctx.attr.target_rust_std[DefaultInfo].files.to_list()
    cargo_home_files = ctx.attr.cargo_home[DefaultInfo].files.to_list()
    zig_toolchain = ctx.toolchains["@rules_zig//zig:toolchain_type"].zigtoolchaininfo
    zig_files = zig_toolchain.zig_files
    zig = None
    for file in zig_files:
        if file.basename in ["zig", "zig.exe"]:
            zig = file
            break
    if zig == None:
        fail("rules_zig toolchain did not provide a zig executable")
    source_manifest = ctx.actions.declare_file(ctx.label.name + "_srcs.json")
    stage_manifest = ctx.actions.declare_file(ctx.label.name + "_stage.json")
    rustc_lib_manifest = ctx.actions.declare_file(ctx.label.name + "_rustc_libs.json")
    host_rust_std_manifest = ctx.actions.declare_file(ctx.label.name + "_host_rust_std.json")

    _write_source_manifest(ctx, src_files, source_manifest)
    staged_input_files = _write_stage_manifest(ctx, ctx.attr.staged_inputs, stage_manifest)
    _write_tool_manifest(ctx, rustc_lib_files, rustc_lib_manifest)
    _write_tool_manifest(ctx, host_rust_std_files, host_rust_std_manifest)

    target_rust_std_manifest = None
    if ctx.attr.target_rust_std:
        target_rust_std_manifest = ctx.actions.declare_file(ctx.label.name + "_target_rust_std.json")
        _write_tool_manifest(ctx, target_rust_std_files, target_rust_std_manifest)

    args = ctx.actions.args()
    args.add(tool.path)
    args.add("--source-manifest", source_manifest.path)
    args.add("--manifest", ctx.file.manifest.short_path)
    args.add("--output", output.path)
    args.add("--built-binary-name", ctx.attr.built_binary_name)
    args.add("--profile", ctx.attr.profile)
    args.add("--stage-manifest", stage_manifest.path)
    args.add("--cargo", cargo.path)
    args.add("--rustc", rustc.path)
    args.add("--cargo-home-marker", cargo.path)
    args.add("--zig", zig.path)
    args.add("--zig-lib-dir", zig_toolchain.zig_lib_rpath)
    args.add("--rustc-lib-manifest", rustc_lib_manifest.path)
    args.add("--host-rust-std-manifest", host_rust_std_manifest.path)
    if ctx.attr.target_triple:
        args.add("--target-triple", ctx.attr.target_triple)
    if target_rust_std_manifest:
        args.add("--target-rust-std-manifest", target_rust_std_manifest.path)
    if ctx.attr.locked:
        args.add("--locked")
    if ctx.attr.frontend_dist:
        frontend_dist = ctx.attr.frontend_dist[DefaultInfo].files.to_list()
        if len(frontend_dist) != 1:
            fail("frontend_dist must provide exactly one directory")
        args.add("--frontend-dist", frontend_dist[0].path)
        args.add("--frontend-dist-dest", ctx.attr.frontend_dist_dest)

    inputs = src_files + [
        ctx.file.manifest,
        tool,
        source_manifest,
        stage_manifest,
        rustc_lib_manifest,
        host_rust_std_manifest,
        cargo,
        rustc,
        zig,
    ] + staged_input_files + cargo_home_files + rustc_lib_files + host_rust_std_files + zig_files
    if target_rust_std_manifest:
        inputs.append(target_rust_std_manifest)
        inputs.extend(target_rust_std_files)
    if ctx.attr.frontend_dist:
        inputs.extend(ctx.attr.frontend_dist[DefaultInfo].files.to_list())

    ctx.actions.run_shell(
        inputs = depset(direct = inputs),
        outputs = [output],
        command = """
set -euo pipefail
python3 "$@"
""",
        arguments = [args],
        mnemonic = "KannaCargoBinary",
        progress_message = "Building cargo binary for %s" % ctx.label.name,
        use_default_shell_env = True,
    )

    return [DefaultInfo(files = depset([output]))]

def _copy_tree_impl(ctx):
    srcs = ctx.attr.src[DefaultInfo].files.to_list()
    if len(srcs) != 1:
        fail("src must provide exactly one file or directory")

    source = srcs[0]
    out_dir = ctx.actions.declare_directory(ctx.label.name)

    ctx.actions.run_shell(
        inputs = depset(direct = [source]),
        outputs = [out_dir],
        command = """
set -euo pipefail
mkdir -p "$2"
cp -R "$1"/. "$2"
""",
        arguments = [
            source.path,
            out_dir.path,
        ],
        mnemonic = "KannaCopyTree",
        progress_message = "Copying tree for %s" % ctx.label.name,
    )

    return [DefaultInfo(files = depset([out_dir]))]

def _macos_dmg_impl(ctx):
    srcs = ctx.attr.app[DefaultInfo].files.to_list()
    app_candidates = [src for src in srcs if src.basename.endswith(".app")]
    if len(app_candidates) != 1:
        fail("app must provide exactly one .app directory, got %s" % [src.basename for src in srcs])

    app = app_candidates[0]
    output = ctx.actions.declare_file(ctx.attr.output_name)
    tool = ctx.file._tool

    args = ctx.actions.args()
    args.add("--app", app.path)
    args.add("--output", output.path)
    args.add("--volume-name", ctx.attr.volume_name)
    if ctx.attr.include_applications_link:
        args.add("--include-applications-link")

    ctx.actions.run_shell(
        inputs = depset(direct = [app, tool]),
        outputs = [output],
        command = """
set -euo pipefail
python3 "$@"
""",
        arguments = [tool.path, args],
        mnemonic = "KannaMacosDmg",
        progress_message = "Creating DMG for %s" % ctx.label.name,
        use_default_shell_env = True,
    )

    return [DefaultInfo(files = depset([output]))]

def _macos_codesign_app_impl(ctx):
    srcs = ctx.attr.app[DefaultInfo].files.to_list()
    app_candidates = [src for src in srcs if src.basename.endswith(".app")]
    if len(app_candidates) != 1:
        fail("app must provide exactly one .app directory, got %s" % [src.basename for src in srcs])

    app = app_candidates[0]
    out_dir = ctx.actions.declare_directory(ctx.attr.output_name)
    tool = ctx.file._tool

    args = ctx.actions.args()
    args.add("--app", app.path)
    args.add("--output", out_dir.path)
    if ctx.attr.signing_identity:
        args.add("--signing-identity", ctx.attr.signing_identity)

    ctx.actions.run_shell(
        inputs = depset(direct = [app, tool]),
        outputs = [out_dir],
        command = """
set -euo pipefail
python3 "$@"
""",
        arguments = [tool.path, args],
        mnemonic = "KannaMacosCodesignApp",
        progress_message = "Codesigning app for %s" % ctx.label.name,
        use_default_shell_env = True,
    )

    return [DefaultInfo(files = depset([out_dir]))]

def _macos_codesign_file_impl(ctx):
    srcs = ctx.attr.src[DefaultInfo].files.to_list()
    if len(srcs) != 1:
        fail("src must provide exactly one file, got %s" % [src.basename for src in srcs])

    src = srcs[0]
    output = ctx.actions.declare_file(ctx.attr.output_name)
    tool = ctx.file._tool

    args = ctx.actions.args()
    args.add("--input", src.path)
    args.add("--output", output.path)
    if ctx.attr.signing_identity:
        args.add("--signing-identity", ctx.attr.signing_identity)

    ctx.actions.run_shell(
        inputs = depset(direct = [src, tool]),
        outputs = [output],
        command = """
set -euo pipefail
python3 "$@"
""",
        arguments = [tool.path, args],
        mnemonic = "KannaMacosCodesignFile",
        progress_message = "Codesigning file for %s" % ctx.label.name,
        use_default_shell_env = True,
    )

    return [DefaultInfo(files = depset([output]))]

def _macos_notarize_dmg_impl(ctx):
    srcs = ctx.attr.dmg[DefaultInfo].files.to_list()
    if len(srcs) != 1:
        fail("dmg must provide exactly one file, got %s" % [src.basename for src in srcs])

    dmg = srcs[0]
    output = ctx.actions.declare_file(ctx.attr.output_name)
    tool = ctx.file._tool

    args = ctx.actions.args()
    args.add("--dmg", dmg.path)
    args.add("--output", output.path)

    ctx.actions.run_shell(
        inputs = depset(direct = [dmg, tool]),
        outputs = [output],
        command = """
set -euo pipefail
python3 "$@"
""",
        arguments = [tool.path, args],
        mnemonic = "KannaMacosNotarizeDmg",
        progress_message = "Notarizing DMG for %s" % ctx.label.name,
        use_default_shell_env = True,
    )

    return [DefaultInfo(files = depset([output]))]

bun_vite_dist = rule(
    implementation = _bun_vite_dist_impl,
    attrs = {
        "srcs": attr.label_list(allow_files = True, mandatory = True),
        "package_dir": attr.string(mandatory = True),
        "_tool": attr.label(
            allow_single_file = True,
            default = "//tools/bazel:build_frontend_dist.py",
        ),
        "_bun": attr.label(
            allow_single_file = True,
            default = "@kanna_host_bun//:bun",
        ),
    },
)

cargo_binary = rule(
    implementation = _cargo_binary_impl,
    attrs = {
        "srcs": attr.label_list(allow_files = True, mandatory = True),
        "manifest": attr.label(allow_single_file = True, mandatory = True),
        "built_binary_name": attr.string(mandatory = True),
        "output_name": attr.string(mandatory = True),
        "target_triple": attr.string(),
        "profile": attr.string(default = "debug"),
        "locked": attr.bool(default = False),
        "frontend_dist": attr.label(),
        "frontend_dist_dest": attr.string(default = ""),
        "staged_inputs": attr.label_keyed_string_dict(allow_files = True),
        "_tool": attr.label(
            allow_single_file = True,
            default = "//tools/bazel:build_cargo_binary.py",
        ),
        "cargo_tool": attr.label(
            allow_single_file = True,
            default = "@kanna_rust_host_tools//:cargo",
        ),
        "rustc_tool": attr.label(
            allow_single_file = True,
            default = "@kanna_rust_host_tools//:rustc",
        ),
        "rustc_libs": attr.label(
            default = "@kanna_rust_host_tools//:rustc_lib",
        ),
        "host_rust_std": attr.label(
            default = "@kanna_rust_host_tools//:rust_std-aarch64-apple-darwin",
        ),
        "target_rust_std": attr.label(),
        "cargo_home": attr.label(
            default = "@kanna_host_cargo_home//:all",
        ),
    },
    toolchains = ["@rules_zig//zig:toolchain_type"],
)

copy_tree = rule(
    implementation = _copy_tree_impl,
    attrs = {
        "src": attr.label(mandatory = True),
    },
)

macos_dmg = rule(
    implementation = _macos_dmg_impl,
    attrs = {
        "app": attr.label(mandatory = True),
        "output_name": attr.string(mandatory = True),
        "volume_name": attr.string(mandatory = True),
        "include_applications_link": attr.bool(default = True),
        "_tool": attr.label(
            allow_single_file = True,
            default = "//tools/bazel:build_macos_dmg.py",
        ),
    },
)

macos_codesign_app = rule(
    implementation = _macos_codesign_app_impl,
    attrs = {
        "app": attr.label(mandatory = True),
        "output_name": attr.string(mandatory = True),
        "signing_identity": attr.string(),
        "_tool": attr.label(
            allow_single_file = True,
            default = "//tools/bazel:build_macos_signed_app.py",
        ),
    },
)

macos_codesign_file = rule(
    implementation = _macos_codesign_file_impl,
    attrs = {
        "src": attr.label(mandatory = True),
        "output_name": attr.string(mandatory = True),
        "signing_identity": attr.string(),
        "_tool": attr.label(
            allow_single_file = True,
            default = "//tools/bazel:build_macos_signed_file.py",
        ),
    },
)

macos_notarize_dmg = rule(
    implementation = _macos_notarize_dmg_impl,
    attrs = {
        "dmg": attr.label(mandatory = True),
        "output_name": attr.string(mandatory = True),
        "_tool": attr.label(
            allow_single_file = True,
            default = "//tools/bazel:build_macos_notarized_dmg.py",
        ),
    },
)

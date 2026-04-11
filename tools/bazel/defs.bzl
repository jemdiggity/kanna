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

def _bun_vite_dist_impl(ctx):
    out_dir = ctx.actions.declare_directory(ctx.label.name)
    src_files = _files_from_targets(ctx.attr.srcs)
    tool = ctx.file._tool
    pnpm = ctx.file._pnpm
    node = ctx.file._node
    source_manifest = ctx.actions.declare_file(ctx.label.name + "_srcs.json")

    _write_source_manifest(ctx, src_files, source_manifest)

    ctx.actions.run_shell(
        inputs = depset(direct = src_files + [tool, source_manifest, pnpm, node]),
        outputs = [out_dir],
        command = """
set -euo pipefail
python3 "$1" --source-manifest "$2" --package-dir "$3" --out-dir "$4" --pnpm "$5" --node "$6"
""",
        arguments = [
            tool.path,
            source_manifest.path,
            ctx.attr.package_dir,
            out_dir.path,
            pnpm.path,
            node.path,
        ],
        mnemonic = "KannaBunViteDist",
        progress_message = "Building frontend dist for %s" % ctx.label.name,
        use_default_shell_env = True,
    )

    return [DefaultInfo(files = depset([out_dir]))]

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
        "_pnpm": attr.label(
            allow_single_file = True,
            default = "@pnpm//:pnpm",
        ),
        "_node": attr.label(
            allow_single_file = True,
            default = "@nodejs//:node",
        ),
    },
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

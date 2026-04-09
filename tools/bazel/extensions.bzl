"""Host-backed tool repository helpers for local Bazel integration."""

def _binary_repo_impl(repository_ctx):
    binary_name = repository_ctx.attr.binary_name
    binary = repository_ctx.which(binary_name)
    if binary == None:
        fail("required host binary %r was not found on PATH" % binary_name)

    repository_ctx.symlink(binary, binary_name)
    repository_ctx.file(
        "BUILD.bazel",
        content = """
package(default_visibility = ["//visibility:public"])

exports_files(["{name}"])
""".format(name = binary_name),
    )

_binary_repo = repository_rule(
    implementation = _binary_repo_impl,
    attrs = {
        "binary_name": attr.string(mandatory = True),
    },
    local = True,
)

def _extract_quoted_field(text, field_name):
    needle = '.%s = "' % field_name
    start = text.find(needle)
    if start == -1:
        fail("could not find %s in zig env output" % field_name)
    start += len(needle)
    end = text.find('"', start)
    if end == -1:
        fail("could not parse %s in zig env output" % field_name)
    return text[start:end]

def _zig_repo_impl(repository_ctx):
    zig = repository_ctx.which("zig")
    if zig == None:
        fail("required host binary %r was not found on PATH" % "zig")

    env_result = repository_ctx.execute([zig, "env"])
    if env_result.return_code != 0:
        fail("zig env failed: %s" % env_result.stderr)

    lib_dir = _extract_quoted_field(env_result.stdout, "lib_dir")

    repository_ctx.symlink(zig, "zig")
    repository_ctx.symlink(repository_ctx.path(lib_dir), "lib")
    repository_ctx.file("ROOT", content = "zig\n")
    repository_ctx.file(
        "BUILD.bazel",
        content = """
package(default_visibility = ["//visibility:public"])

filegroup(
    name = "all",
    srcs = glob(["lib/**"], allow_empty = True),
)

exports_files([
    "ROOT",
    "zig",
])
""",
    )

_zig_repo = repository_rule(
    implementation = _zig_repo_impl,
    local = True,
)

def _home_repo_impl(repository_ctx):
    relative_home = repository_ctx.attr.relative_home
    home_root = repository_ctx.os.environ.get("HOME")
    if not home_root:
        fail("HOME must be set to locate %s" % relative_home)

    source = repository_ctx.path(home_root + "/" + relative_home)
    if not source.exists:
        fail("required host path %s does not exist" % source)

    repository_ctx.symlink(source, "home")
    repository_ctx.file("ROOT", content = relative_home + "\n")
    exports = []
    exports.append('"ROOT"')
    if repository_ctx.attr.marker_path:
        exports.append('"home/{path}"'.format(path = repository_ctx.attr.marker_path))
    if repository_ctx.attr.tool_path:
        exports.append('"home/{path}"'.format(path = repository_ctx.attr.tool_path))

    repository_ctx.file(
        "BUILD.bazel",
        content = """
package(default_visibility = ["//visibility:public"])

filegroup(
    name = "all",
    srcs = glob(["home/**"], allow_empty = True),
)

exports_files([{exports}])
""".format(exports = ", ".join(exports)),
    )

_home_repo = repository_rule(
    implementation = _home_repo_impl,
    attrs = {
        "relative_home": attr.string(mandatory = True),
        "marker_path": attr.string(),
        "tool_path": attr.string(),
    },
    local = True,
)

def _host_tools_impl(_module_ctx):
    _binary_repo(
        name = "kanna_host_bun",
        binary_name = "bun",
    )
    _zig_repo(
        name = "kanna_host_zig",
    )
    _home_repo(
        name = "kanna_host_cargo_home",
        relative_home = ".cargo",
        tool_path = "bin/cargo",
    )
    _home_repo(
        name = "kanna_host_rustup_home",
        relative_home = ".rustup",
        marker_path = "settings.toml",
    )
    _home_repo(
        name = "kanna_host_zig_cache",
        relative_home = ".cache/zig",
    )

host_tools = module_extension(
    implementation = _host_tools_impl,
)

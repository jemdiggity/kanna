const BAZEL_FILENAMES = new Set([
  "BUILD",
  "BUILD.bazel",
  "WORKSPACE",
  "WORKSPACE.bazel",
  "MODULE.bazel",
]);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  vue: "vue",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  sh: "bash",
  zsh: "bash",
  bash: "bash",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  xml: "xml",
  svg: "xml",
  graphql: "graphql",
};

function getBaseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function isBazelSyntaxPath(path: string): boolean {
  const baseName = getBaseName(path);
  return BAZEL_FILENAMES.has(baseName) || baseName.endsWith(".bzl");
}

export function getSyntaxLanguageForPath(path: string): string {
  if (isBazelSyntaxPath(path)) {
    return "python";
  }

  const ext = getBaseName(path).split(".").pop()?.toLowerCase() || "";
  return EXTENSION_LANGUAGE_MAP[ext] || "text";
}

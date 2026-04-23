export type LifecycleHookKind = "Setup" | "Teardown";

export function shellSingleQuote(value: string): string {
  return value.replace(/'/g, "'\\''");
}

export function renderVisibleLifecycleCommand(command: string): string {
  const escaped = shellSingleQuote(command);
  return `printf '\\033[2m$ %s\\033[0m\\n' '${escaped}'`;
}

export function renderBestEffortLifecycleCommand(command: string, kind: LifecycleHookKind): string {
  const escaped = shellSingleQuote(command);
  return [
    `( { ${renderVisibleLifecycleCommand(command)} && ( ${command} ); }`,
    `|| printf '\\033[31m${kind} command failed; continuing: %s\\033[0m\\n' '${escaped}'`,
    ")",
  ].join(" ");
}

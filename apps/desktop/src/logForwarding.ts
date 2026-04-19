export function formatLogArgument(arg: unknown): string {
  if (arg instanceof Error) {
    const maybeCode = (arg as Error & { code?: unknown }).code;
    const code = typeof maybeCode === "string" ? ` code=${maybeCode}` : "";
    const stack = typeof arg.stack === "string" && arg.stack.length > 0 ? `\n${arg.stack}` : "";
    return `${arg.name}: ${arg.message}${code}${stack}`;
  }

  try {
    return typeof arg === "string" ? arg : JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

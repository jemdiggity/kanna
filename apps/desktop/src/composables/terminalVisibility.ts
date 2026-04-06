export function shouldStartTerminalSession(active: boolean | undefined): boolean {
  return active !== false;
}

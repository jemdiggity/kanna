export function encodeDaemonInput(input: string): number[] {
  return Array.from(new TextEncoder().encode(input));
}

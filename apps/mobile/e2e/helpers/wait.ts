export async function waitFor<T>(
  label: string,
  check: () => Promise<T | null>,
  options?: {
    intervalMs?: number;
    timeoutMs?: number;
  }
): Promise<T> {
  const intervalMs = options?.intervalMs ?? 500;
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await check();
    if (result !== null) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out while waiting for ${label}`);
}

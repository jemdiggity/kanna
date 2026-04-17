function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getWebDriverPort(): number {
  return readPort("KANNA_WEBDRIVER_PORT", 4445);
}

export function getWebDriverBaseUrl(): string {
  return `http://127.0.0.1:${getWebDriverPort()}`;
}

export function getSecondaryWebDriverPort(): number {
  return readPort("KANNA_E2E_TARGET_WEBDRIVER_PORT", getWebDriverPort() + 1);
}

const DEFAULT_WEBDRIVER_PORT = 4445;
const DEFAULT_DEV_PORT = 1420;

export function getWebDriverPort(): number {
  const explicitPort = process.env.TAURI_WEBDRIVER_PORT;
  if (explicitPort) {
    const parsed = Number.parseInt(explicitPort, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }

  const devPort = process.env.KANNA_DEV_PORT;
  if (devPort) {
    const parsed = Number.parseInt(devPort, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed + (DEFAULT_WEBDRIVER_PORT - DEFAULT_DEV_PORT);
    }
  }

  return DEFAULT_WEBDRIVER_PORT;
}

export function getWebDriverBaseUrl(): string {
  return `http://127.0.0.1:${getWebDriverPort()}`;
}

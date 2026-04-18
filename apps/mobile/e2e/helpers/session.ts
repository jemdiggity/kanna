import { remote, type Browser } from "webdriverio";

export async function createMobileSession(options: {
  hostname?: string;
  port: number;
  capabilities: Record<string, unknown>;
}): Promise<Browser> {
  return remote({
    hostname: options.hostname || "127.0.0.1",
    path: "/",
    port: options.port,
    capabilities: options.capabilities
  });
}

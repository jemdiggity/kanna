import { describe, expect, it } from "vitest";
import { createRemoteTransport } from "./remoteTransport";

describe("remote transport", () => {
  it("maps cloud desktop records into the mobile desktop summary shape", async () => {
    const transport = createRemoteTransport(async () => [
      {
        desktopId: "desktop-1",
        displayName: "Studio Mac",
        online: true,
        reachableViaRelay: true,
        connectionMode: "both",
      },
    ]);

    await expect(transport.listDesktops()).resolves.toEqual([
      {
        id: "desktop-1",
        name: "Studio Mac",
        online: true,
        mode: "remote",
        reachableViaRelay: true,
        connectionMode: "both",
        lastSeenAt: null,
      },
    ]);
  });
});

import { expect, it, vi } from "vitest";
import { createAppModel } from "./appModel";

it("creates an app model with desktop navigation and a LAN client", async () => {
  const model = createAppModel("http://desktop.test", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      state: "running",
      desktopId: "desktop-1",
      desktopName: "Studio Mac",
      lanHost: "0.0.0.0",
      lanPort: 48120,
      pairingCode: null
    })
  })));

  expect(model.navigator.tabs.map((tab) => tab.label)).toContain("Desktops");
  expect((await model.client.getStatus()).desktopName).toBe("Studio Mac");
});

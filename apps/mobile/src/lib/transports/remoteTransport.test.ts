import { describe, expect, it, vi } from "vitest";
import {
  createRemoteTransport,
  RemoteTransportError,
  type RemoteDesktopInvoker
} from "./remoteTransport";

describe("remote transport", () => {
  it("maps cloud desktop records into the mobile desktop summary shape", async () => {
    const transport = createRemoteTransport({
      listDesktopRecords: async () => [
        {
          desktopId: "desktop-1",
          displayName: "Studio Mac",
          online: true,
          reachableViaRelay: true,
          connectionMode: "both",
          lastSeenAt: "2026-05-08T12:00:00.000Z"
        },
        {
          desktopId: "desktop-2",
          displayName: "Travel Mac",
          online: false,
          reachableViaRelay: false,
          connectionMode: "internet"
        }
      ],
      getSelectedDesktopId: () => "desktop-1",
      invokeDesktop: async () => ({
        state: "running",
        desktopId: "desktop-1",
        desktopName: "Studio Mac",
        lanHost: "0.0.0.0",
        lanPort: 48120,
        pairingCode: null
      })
    });

    await expect(transport.listDesktops()).resolves.toEqual([
      {
        id: "desktop-1",
        name: "Studio Mac",
        online: true,
        mode: "remote",
        reachableViaRelay: true,
        connectionMode: "both",
        lastSeenAt: "2026-05-08T12:00:00.000Z"
      },
      {
        id: "desktop-2",
        name: "Travel Mac",
        online: false,
        mode: "remote",
        reachableViaRelay: false,
        connectionMode: "internet",
        lastSeenAt: null
      }
    ]);
  });

  it("fetches minimal status for the selected desktop through the remote invocation envelope", async () => {
    const invokeDesktop = vi.fn<RemoteDesktopInvoker>().mockResolvedValue({
      state: "running",
      desktopId: "desktop-1",
      desktopName: "Studio Mac",
      lanHost: "10.0.0.2",
      lanPort: 48120,
      pairingCode: null
    });
    const transport = createRemoteTransport({
      listDesktopRecords: async () => [],
      getSelectedDesktopId: () => "desktop-1",
      invokeDesktop
    });

    await expect(transport.getStatus()).resolves.toEqual({
      state: "running",
      desktopId: "desktop-1",
      desktopName: "Studio Mac",
      lanHost: "10.0.0.2",
      lanPort: 48120,
      pairingCode: null
    });
    expect(invokeDesktop).toHaveBeenCalledWith({
      desktopId: "desktop-1",
      method: "GET",
      path: "/v1/status",
      body: null
    });
  });

  it("throws a typed error when status is requested without a selected desktop", async () => {
    const invokeDesktop = vi.fn<RemoteDesktopInvoker>();
    const transport = createRemoteTransport({
      listDesktopRecords: async () => [],
      getSelectedDesktopId: () => null,
      invokeDesktop
    });

    await expect(transport.getStatus()).rejects.toMatchObject({
      code: "no_selected_desktop",
      message: "Select a desktop before connecting remotely."
    });
    await expect(transport.getStatus()).rejects.toBeInstanceOf(RemoteTransportError);
    expect(invokeDesktop).not.toHaveBeenCalled();
  });

  it("wraps remote invocation failures with a typed displayable error", async () => {
    const transport = createRemoteTransport({
      listDesktopRecords: async () => [],
      getSelectedDesktopId: () => "desktop-offline",
      invokeDesktop: async () => {
        throw new Error("relay unavailable");
      }
    });

    await expect(transport.getStatus()).rejects.toMatchObject({
      code: "remote_invocation_failed",
      message: "Remote desktop request failed: relay unavailable"
    });
  });
});

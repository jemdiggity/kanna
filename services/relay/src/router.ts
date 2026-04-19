import type { WebSocket } from "ws";

interface ConnectionPair {
  phone?: WebSocket;
  desktops: Map<string, WebSocket>;
}

/** In-memory map of userId → {phone, server} WebSocket connections. */
const connections = new Map<string, ConnectionPair>();

/**
 * Store the phone-side WebSocket for a user.
 * Closes any existing phone connection for this user.
 * Cleans up the map entry when the socket closes.
 */
export function setPhoneConnection(userId: string, ws: WebSocket): void {
  let pair = connections.get(userId);
  if (!pair) {
    pair = { desktops: new Map() };
    connections.set(userId, pair);
  }

  // Close existing phone connection if any
  if (pair.phone && pair.phone !== ws && pair.phone.readyState <= 1) {
    console.log(`[router] Closing existing phone connection for ${userId}`);
    pair.phone.close(1000, "Replaced by new connection");
  }

  pair.phone = ws;
  console.log(`[router] Phone connected for ${userId}`);

  ws.on("close", () => {
    console.log(`[router] Phone disconnected for ${userId}`);
    const current = connections.get(userId);
    if (current?.phone === ws) {
      current.phone = undefined;
      // Clean up map entry if both sides are gone
      if (current.desktops.size === 0) {
        connections.delete(userId);
      }
    }
  });
}

/**
 * Store the server-side (kanna-server) WebSocket for a user.
 * Closes any existing server connection for this user.
 * Cleans up the map entry when the socket closes.
 */
export function setServerConnection(
  userId: string,
  desktopId: string,
  ws: WebSocket
): void {
  let pair = connections.get(userId);
  if (!pair) {
    pair = { desktops: new Map() };
    connections.set(userId, pair);
  }

  const existing = pair.desktops.get(desktopId);
  if (existing && existing !== ws && existing.readyState <= 1) {
    console.log(
      `[router] Closing existing server connection for ${userId}/${desktopId}`
    );
    existing.close(1000, "Replaced by new connection");
  }

  pair.desktops.set(desktopId, ws);
  console.log(`[router] Server connected for ${userId}/${desktopId}`);

  ws.on("close", () => {
    console.log(`[router] Server disconnected for ${userId}/${desktopId}`);
    const current = connections.get(userId);
    if (current?.desktops.get(desktopId) === ws) {
      current.desktops.delete(desktopId);
      // Clean up map entry if both sides are gone
      if (!current.phone) {
        connections.delete(userId);
      }
    }
  });
}

/**
 * Route a message from one side to the other.
 *
 * - If phone sends to an offline server: parse JSON and return an error response.
 * - If server sends to an offline phone: silently drop the message.
 */
export function routeMessage(
  userId: string,
  from: "phone" | "server",
  data: string
): void {
  const pair = connections.get(userId);

  if (from === "phone") {
    let target: WebSocket | undefined;

    try {
      const parsed = JSON.parse(data) as { desktopId?: string; id?: unknown };
      if (parsed.desktopId) {
        target = pair?.desktops.get(parsed.desktopId);
      } else if ((pair?.desktops.size ?? 0) === 1) {
        target = Array.from(pair!.desktops.values())[0];
      }
    } catch {
      target = undefined;
    }

    if (target && target.readyState === 1) {
      target.send(data);
    } else {
      // Server is offline — send error response back to phone
      try {
        const parsed = JSON.parse(data);
        if (parsed.id != null) {
          const errorResponse = JSON.stringify({
            type: "response",
            id: parsed.id,
            error: "Desktop offline",
          });
          const phone = pair?.phone;
          if (phone && phone.readyState === 1) {
            phone.send(errorResponse);
          }
        }
      } catch {
        // Not valid JSON or no id — can't send error response
        console.warn(
          `[router] Phone message to offline server for ${userId}, could not parse for error response`
        );
      }
    }
  } else {
    // from === "server"
    const target = pair?.phone;
    if (target && target.readyState === 1) {
      target.send(data);
    } else {
      // Phone is offline — silently drop
    }
  }
}

/** Get current connection count (for health/debug). */
export function getConnectionCount(): number {
  return connections.size;
}

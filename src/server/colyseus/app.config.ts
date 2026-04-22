import type { Server as HttpServer } from "node:http"

import { Server } from "@colyseus/core"
import { WebSocketTransport } from "@colyseus/ws-transport"
import type { WebSocketServer } from "ws"

import { ChatRoom } from "./rooms/ChatRoom"
import { GameLobbyRoom } from "./rooms/GameLobbyRoom"
import type { ChatStore } from "../store/types"

/**
 * Colyseus server bootstrap: wires WebSocketTransport to the shared HTTP server,
 * registers room classes by name, and exposes helpers to reach the underlying ws server.
 */

type WebSocketTransportWithWss = WebSocketTransport & { readonly wss: WebSocketServer }

/**
 * Returns the underlying WebSocketServer from the Colyseus transport.
 *
 * @param gameServer - The Colyseus Server instance.
 * @returns The ws.WebSocketServer attached to the transport.
 * @throws If the transport does not expose a wss property.
 */
function getWsTransport(gameServer: Server): WebSocketTransportWithWss {
  const transport = (gameServer as unknown as { transport?: unknown }).transport
  if (transport && typeof transport === "object" && "wss" in transport && transport.wss != null) {
    return transport as WebSocketTransportWithWss
  }
  throw new Error("Colyseus game server is missing a WebSocket transport with wss")
}

/**
 * Creates and configures the Colyseus server, registering all room classes.
 *
 * @param httpServer - Existing Node HTTP server; Colyseus attaches its WebSocket server here.
 * @param chatStore - When set, ChatRoom instances receive it on create for DB-backed persistence.
 * @returns Configured Colyseus Server instance.
 */
export const createColyseusServer = (httpServer: HttpServer, chatStore?: ChatStore): Server => {
  const transport = new WebSocketTransport({
    server: httpServer,
    maxPayload: 64 * 1024,
  })

  const gameServer = new Server({ transport })

  gameServer.define("chat", ChatRoom).on("create", (room: ChatRoom) => {
    if (chatStore) {
      room.setChatStore(chatStore)
    }
  })
  gameServer.define("game_lobby", GameLobbyRoom)

  return gameServer
}

/**
 * Returns the underlying ws.WebSocketServer so the host process can route raw upgrade requests.
 *
 * @param gameServer - Configured Colyseus Server instance.
 * @returns The ws.WebSocketServer attached to the transport.
 */
export const getColyseusWss = (gameServer: Server): WebSocketServer => {
  return getWsTransport(gameServer).wss
}

import { createServer, type Server as HttpServer } from "node:http"

import { Server, matchMaker } from "@colyseus/core"
import { WebSocketTransport } from "@colyseus/ws-transport"
import { Client as ColyseusClient } from "@colyseus/sdk"
import type { WebSocketServer } from "ws"

import { ChatRoom } from "@/server/colyseus/rooms/ChatRoom"
import { GameLobbyRoom } from "@/server/colyseus/rooms/GameLobbyRoom"
import { signToken } from "@/server/auth"

/**
 * Returns the port number the HTTP server is listening on.
 *
 * @param httpServer - A listening Node HTTP server.
 * @returns The assigned port number.
 * @throws If the server address cannot be resolved to an object with a port.
 */
function getAssignedPort(httpServer: HttpServer): number {
  const addr = httpServer.address()
  if (addr && typeof addr === "object") return addr.port
  throw new Error("Could not determine server port")
}

/** Descriptor for a running in-process Colyseus test server. */
export type TestServer = {
  gameServer: Server
  httpServer: HttpServer
  wss: WebSocketServer
  sdk: ColyseusClient
  port: number
}

/**
 * Boots a Colyseus server on a random available port, registers wizard-wars rooms,
 * and returns a connected SDK client and server handle for test use.
 *
 * @returns A TestServer ready for SDK calls.
 */
export async function bootTestServer(): Promise<TestServer> {
  const httpServer = createServer()
  const transport = new WebSocketTransport({ server: httpServer })
  const gameServer = new Server({ transport })

  gameServer.define("chat", ChatRoom)
  gameServer.define("game_lobby", GameLobbyRoom)

  await gameServer.listen(0)

  const port = getAssignedPort(httpServer)
  const wss = (transport as unknown as { wss: WebSocketServer }).wss
  const sdk = new ColyseusClient(`ws://127.0.0.1:${port}`)

  return { gameServer, httpServer, wss, sdk, port }
}

/**
 * Gracefully shuts down a test server: disconnects all rooms, closes WebSocket
 * clients, and shuts down the HTTP server.
 *
 * @param server - The TestServer returned by bootTestServer.
 */
export async function shutdownTestServer(server: TestServer): Promise<void> {
  const rooms = await matchMaker.query({}).catch(() => [])
  const disconnects: Promise<unknown>[] = []

  for (const info of rooms) {
    try {
      const r = matchMaker.getRoomById(info.roomId)
      if (r) disconnects.push(r.disconnect())
    } catch {
      // ignore rooms already gone
    }
  }

  await Promise.race([Promise.all(disconnects), delay(3000)])

  for (const ws of server.wss.clients) {
    ws.terminate()
  }
  server.wss.close()
  server.httpServer.closeAllConnections()
  server.httpServer.close()
  server.httpServer.unref()
}

/**
 * Creates a signed JWT for a test user.
 *
 * @param sub - User ID to embed as the JWT subject.
 * @param username - Display username to embed as a claim.
 * @returns A compact JWT string suitable for Colyseus `onAuth` options.
 */
export async function createTestToken(sub: string, username: string): Promise<string> {
  return signToken({ sub, username })
}

/**
 * Returns a Promise that resolves after the given number of milliseconds.
 *
 * @param ms - How long to wait.
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

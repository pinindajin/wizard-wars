import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"
import type { Room } from "@colyseus/sdk"

/**
 * Fast integration smoke test: verifies a Colyseus server boots in-process,
 * a chat room is joinable with a valid JWT, and the server shuts down cleanly.
 * No Postgres connection is made — the ChatRoom uses only JWT auth.
 */
describe("fast integration smoke — Colyseus boot", { timeout: 15_000 }, () => {
  let server: TestServer
  let room: Room

  beforeAll(async () => {
    server = await bootTestServer()
    const token = await createTestToken("smoke-user-1", "smokePlayer")
    room = await server.sdk.joinOrCreate("chat", { token })
    await delay(100)
  })

  afterAll(async () => {
    await room?.leave().catch(() => {})
    await shutdownTestServer(server)
  })

  it("server is reachable and returns a room ID", () => {
    expect(server.port).toBeGreaterThan(0)
    expect(room.roomId).toBeTruthy()
  })

  it("connects to the chat room without touching Postgres", () => {
    expect(room.connection.isOpen).toBe(true)
  })
})

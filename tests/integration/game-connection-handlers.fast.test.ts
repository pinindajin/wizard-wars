import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Room } from "@colyseus/sdk"

import { GameConnection } from "@/game/network/GameConnection"
import { RoomEvent } from "@/shared/roomEvents"
import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"
import { playerLobbyIndex } from "@/server/colyseus/rooms/GameLobbyRoom"

describe(
  "GameConnection handler coverage (no onMessage warnings)",
  { timeout: 30_000 },
  () => {
    let server: TestServer

    beforeAll(async () => {
      server = await bootTestServer()
    })

    afterAll(async () => {
      await shutdownTestServer(server)
      playerLobbyIndex.clear()
    })

    it("emits no Colyseus 'onMessage not registered' warnings for player_join / lobby_state / lobby_chat_history", async () => {
      playerLobbyIndex.clear()

      // Create a lobby via the raw SDK so we have a real roomId for connectById.
      const hostToken = await createTestToken("u-host-warn", "HostWarn")
      const hostRoom: Room = await server.sdk.create("game_lobby", {
        token: hostToken,
      })
      // Silence warnings from the raw-SDK host room so they don't leak into
      // the assertion scoped to the GameConnection under test.
      hostRoom.onMessage("*", () => {})
      const roomId = hostRoom.roomId

      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined)

      const token = await createTestToken("u-conn-warn", "ConnWarn")
      const conn = new GameConnection({
        serverUrl: `ws://127.0.0.1:${server.port}`,
        token,
      })
      // connectById wires the wildcard + explicit silencers before the server
      // can broadcast anything else to this client.
      await conn.connectById(roomId)

      const forwarded: string[] = []
      conn.onMessage((m) => forwarded.push(m.type))

      // Give the server a window to broadcast lobby_state / player_join.
      await delay(800)

      const silenced = [
        RoomEvent.PlayerJoin,
        RoomEvent.LobbyState,
        RoomEvent.LobbyChatHistory,
      ]
      const offending = warnSpy.mock.calls.filter((args) =>
        args.some(
          (a) =>
            typeof a === "string" &&
            /onMessage/i.test(a) &&
            /registered/i.test(a) &&
            silenced.some((t) => a.includes(t)),
        ),
      )
      expect(
        offending,
        `unexpected Colyseus warnings: ${JSON.stringify(offending)}`,
      ).toEqual([])

      warnSpy.mockRestore()
      await conn.close()
      await hostRoom.leave()
    })

    it("sendShopPurchase reaches the server without throwing", async () => {
      playerLobbyIndex.clear()

      const hostToken = await createTestToken("u-host-buy", "HostBuy")
      const hostRoom: Room = await server.sdk.create("game_lobby", {
        token: hostToken,
      })
      hostRoom.onMessage("*", () => {})

      const guestToken = await createTestToken("u-guest-buy", "GuestBuy")
      const conn = new GameConnection({
        serverUrl: `ws://127.0.0.1:${server.port}`,
        token: guestToken,
      })
      await conn.connectById(hostRoom.roomId)

      expect(() => conn.sendShopPurchase("lightning_bolt")).not.toThrow()
      // Allow server to process / potentially respond with shop_error.
      await delay(300)

      await conn.close()
      await hostRoom.leave()
    })
  },
)

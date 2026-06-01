import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Client } from "colyseus"

import { verifyToken } from "../../auth"

import { GameLobbyRoom } from "./GameLobbyRoom"

vi.mock("../../auth", () => ({
  verifyToken: vi.fn(),
}))

type RoomInternals = {
  lobbyPhase: string
  simulation: {
    removePlayer: (playerId: string) => void
    playerEntityMap: Map<string, number>
  } | null
  gameLoopTimer: { clear: () => void } | null
  disposalGraceTimer: { clear: () => void } | null
  removeInProgressPlayerState: (playerId: string) => void
}

const mockedVerifyToken = vi.mocked(verifyToken)

function roomWithClients(clientCount: number): GameLobbyRoom {
  const room = new GameLobbyRoom()
  Object.defineProperty(room, "clients", {
    configurable: true,
    value: Array.from({ length: clientCount }, (_, index) => ({
      userData: { playerId: `player-${index + 1}` },
    })),
  })
  return room
}

function getRoomInternals(room: GameLobbyRoom): RoomInternals {
  return room as unknown as RoomInternals
}

describe("GameLobbyRoom lifecycle", () => {
  beforeEach(() => {
    mockedVerifyToken.mockResolvedValue({
      sub: "player-1",
      username: "PlayerOne",
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("disconnects immediately when final in-progress player cleanup leaves the room empty", () => {
    const room = roomWithClients(0)
    const roomInternals = getRoomInternals(room)
    const removePlayer = vi.fn()
    const clearLoop = vi.fn()
    const disconnect = vi.fn()
    Object.assign(roomInternals as object, {
      disconnect,
      gameLoopTimer: { clear: clearLoop },
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        removePlayer,
        playerEntityMap: new Map([["player-1", 1]]),
      },
    })

    roomInternals.removeInProgressPlayerState("player-1")

    expect(removePlayer).toHaveBeenCalledWith("player-1")
    expect(clearLoop).toHaveBeenCalledOnce()
    expect(roomInternals.gameLoopTimer).toBeNull()
    expect(roomInternals.simulation).toBeNull()
    expect(roomInternals.disposalGraceTimer).toBeNull()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it("keeps an in-progress match alive when another client remains connected", () => {
    const room = roomWithClients(1)
    const roomInternals = getRoomInternals(room)
    const removePlayer = vi.fn()
    const clearLoop = vi.fn()
    const disconnect = vi.fn()
    Object.assign(roomInternals as object, {
      disconnect,
      gameLoopTimer: { clear: clearLoop },
      lobbyPhase: "IN_PROGRESS",
      simulation: {
        removePlayer,
        playerEntityMap: new Map([["expired-player", 1]]),
      },
    })

    roomInternals.removeInProgressPlayerState("expired-player")

    expect(removePlayer).toHaveBeenCalledWith("expired-player")
    expect(clearLoop).not.toHaveBeenCalled()
    expect(roomInternals.simulation).not.toBeNull()
    expect(disconnect).not.toHaveBeenCalled()
  })

  it("rejects auth for terminal in-progress rooms before verifying the token", async () => {
    const room = roomWithClients(0)
    const roomInternals = getRoomInternals(room)
    Object.assign(roomInternals as object, {
      lobbyPhase: "IN_PROGRESS",
      simulation: null,
    })

    await expect(
      room.onAuth({} as Client, { token: "valid-token" }),
    ).rejects.toThrow("match is no longer available")

    expect(mockedVerifyToken).not.toHaveBeenCalled()
  })

  it("rejects terminal in-progress joins before clearing timers or sending hydration", () => {
    const room = roomWithClients(0)
    const roomInternals = getRoomInternals(room)
    const clearDisposal = vi.fn()
    const send = vi.fn()
    const client = {
      send,
      sessionId: "late-session",
    } as unknown as Client
    const auth: Awaited<ReturnType<GameLobbyRoom["onAuth"]>> = {
      sub: "player-1",
      username: "PlayerOne",
    }
    Object.assign(roomInternals as object, {
      disposalGraceTimer: { clear: clearDisposal },
      lobbyPhase: "IN_PROGRESS",
      simulation: null,
    })

    expect(() => room.onJoin(client, {}, auth)).toThrow(
      "match is no longer available",
    )

    expect(clearDisposal).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(roomInternals.disposalGraceTimer).not.toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mainTestState = vi.hoisted(() => ({
  createGame: vi.fn(),
  game: {
    destroy: vi.fn(),
  },
}))

vi.mock("./index", () => ({
  createGame: mainTestState.createGame,
}))

import { mountGame, WW_ABILITY_SLOTS_REGISTRY_KEY } from "./main"

describe("mountGame", () => {
  const previousSessionStorage = globalThis.sessionStorage

  beforeEach(() => {
    mainTestState.createGame.mockReturnValue(mainTestState.game)
    mainTestState.game.destroy.mockClear()
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    })
  })

  afterEach(() => {
    mainTestState.createGame.mockReset()
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: previousSessionStorage,
    })
  })

  it("passes ability slots from React mount options into createGame", () => {
    const gameConnection = { room: { roomId: "server-room-1" } }
    const abilitySlots = ["fireball", null, "lightning_bolt"] as const

    const mounted = mountGame({
      containerId: "game-root",
      lobbyId: "lobby-1",
      token: "token-1",
      gameConnection: gameConnection as never,
      localPlayerId: "player-1",
      abilitySlots,
    })

    expect(WW_ABILITY_SLOTS_REGISTRY_KEY).toBe("wwAbilitySlots")
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      "ww_join_options",
      JSON.stringify({ token: "token-1", lobbyId: "lobby-1" }),
    )
    expect(mainTestState.createGame).toHaveBeenCalledWith(
      "game-root",
      expect.objectContaining({
        gameConnection,
        localPlayerId: "player-1",
        abilitySlots,
      }),
    )
    expect(mounted.game).toBe(mainTestState.game)
  })
})

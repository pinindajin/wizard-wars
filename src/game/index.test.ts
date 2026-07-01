import { beforeEach, describe, expect, it, vi } from "vitest"

const phaserState = vi.hoisted(() => ({
  configs: [] as unknown[],
}))

vi.mock("phaser", () => {
  class Game {
    readonly registryValues = new Map<string, unknown>()
    readonly registry = {
      get: (key: string) => this.registryValues.get(key),
      set: (key: string, value: unknown) => {
        this.registryValues.set(key, value)
      },
    }

    constructor(config: {
      readonly callbacks?: { readonly preBoot?: (game: Game) => void }
    }) {
      phaserState.configs.push(config)
      config.callbacks?.preBoot?.(this)
    }
  }

  return { default: { Game } }
})

vi.mock("./config", () => ({
  gameConfig: {
    type: "mock",
    backgroundColor: "#000000",
  },
}))

import { createGame } from "./index"
import {
  WW_ABILITY_SLOTS_REGISTRY_KEY,
  WW_GAME_CONNECTION_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
} from "./constants"

describe("createGame", () => {
  beforeEach(() => {
    phaserState.configs.length = 0
    delete (globalThis as { __wwGame?: unknown }).__wwGame
  })

  it("copies React-owned ability slots into the Phaser registry during preBoot", () => {
    const abilitySlots = ["fireball", null, "lightning_bolt"] as Array<
      string | null
    >
    const gameConnection = { room: { roomId: "room-1" } }

    const game = createGame("game-root", {
      gameConnection: gameConnection as never,
      localPlayerId: "player-1",
      abilitySlots,
    }) as unknown as {
      readonly registry: { readonly get: (key: string) => unknown }
    }

    const storedSlots = game.registry.get(WW_ABILITY_SLOTS_REGISTRY_KEY)
    expect(storedSlots).toEqual(["fireball", null, "lightning_bolt"])
    expect(storedSlots).not.toBe(abilitySlots)
    expect(game.registry.get(WW_GAME_CONNECTION_REGISTRY_KEY)).toBe(
      gameConnection,
    )
    expect(game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY)).toBe("player-1")
    expect((globalThis as { __wwGame?: unknown }).__wwGame).toBe(game)
  })

  it("boots without optional registry injections", () => {
    const game = createGame("game-root") as unknown as {
      readonly registry: { readonly get: (key: string) => unknown }
    }

    expect(game.registry.get(WW_ABILITY_SLOTS_REGISTRY_KEY)).toBeUndefined()
    expect(phaserState.configs).toHaveLength(1)
  })
})

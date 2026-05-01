import { describe, expect, it, vi } from "vitest"

import { WW_GAMEPLAY_INPUT_BLOCKED_REGISTRY_KEY } from "@/game/constants"

vi.mock("phaser", () => ({
  default: {
    Input: {
      Keyboard: {
        KeyCodes: {
          A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10,
          K: 11, L: 12, M: 13, N: 14, O: 15, P: 16, Q: 17, R: 18, S: 19,
          T: 20, U: 21, V: 22, W: 23, X: 24, Y: 25, Z: 26, ZERO: 27,
          ONE: 28, TWO: 29, THREE: 30, FOUR: 31, FIVE: 32, SIX: 33,
          SEVEN: 34, EIGHT: 35, NINE: 36, TAB: 37, BACK_SLASH: 38,
          SPACE: 39, SHIFT: 40, CTRL: 41, ALT: 42, UP: 43, DOWN: 44,
          LEFT: 45, RIGHT: 46,
        },
        JustDown: () => false,
      },
    },
  },
}))

import { KeyboardController } from "./KeyboardController"

/**
 * Builds a minimal scene shape for KeyboardController tests.
 *
 * @param blocked - Whether gameplay input is blocked in the registry.
 * @returns Phaser-like scene mock.
 */
function scene(blocked: boolean) {
  return {
    game: {
      registry: {
        get: (key: string) => key === WW_GAMEPLAY_INPUT_BLOCKED_REGISTRY_KEY ? blocked : undefined,
      },
    },
    input: {
      keyboard: {
        addKey: () => ({ isDown: true }),
      },
      activePointer: {
        positionToCamera: () => ({ x: 10, y: 20 }),
      },
    },
    cameras: { main: {} },
  } as never
}

describe("KeyboardController", () => {
  it("returns inactive input while gameplay input is blocked", () => {
    vi.stubGlobal("document", { activeElement: null })
    const controller = new KeyboardController(scene(true))
    controller.enable()
    expect(controller.collectInput(7)).toMatchObject({
      up: false,
      down: false,
      left: false,
      right: false,
      abilitySlot: null,
      useQuickItemSlot: null,
      seq: 7,
    })
    vi.unstubAllGlobals()
  })
})

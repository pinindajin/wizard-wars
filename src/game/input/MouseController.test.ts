import { describe, expect, it } from "vitest"

import { WW_GAMEPLAY_INPUT_BLOCKED_REGISTRY_KEY } from "@/game/constants"
import { MouseController } from "./MouseController"

/**
 * Builds a minimal scene shape for MouseController tests.
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
      activePointer: {
        leftButtonDown: () => true,
        rightButtonDown: () => true,
        positionToCamera: () => ({ x: 10, y: 20 }),
      },
    },
    cameras: { main: {} },
  } as never
}

describe("MouseController", () => {
  it("returns inactive input while gameplay input is blocked", () => {
    const controller = new MouseController(scene(true))
    controller.enable()
    expect(controller.collectInput()).toEqual({
      weaponPrimary: false,
      weaponSecondary: false,
      weaponTargetX: 0,
      weaponTargetY: 0,
    })
  })
})

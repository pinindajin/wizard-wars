import { describe, it, expect, vi } from "vitest"

import {
  FIREBALL_CHANNEL_ANIM,
  FIREBALL_CHANNEL_TEXTURE,
  FIREBALL_FLY_ANIM,
  FIREBALL_FLY_TEXTURE,
  LAVA_LAP_ANIM,
  registerFireballAnims,
} from "./FireballAnimDefs"

/**
 * Builds a minimal `Phaser.Animations.AnimationManager` shape covering the
 * three methods our register function calls: `exists`, `create`, and
 * `generateFrameNumbers`. Tracks every created key so tests can assert on it.
 */
function mockAnimManager() {
  const created: { key: string; frameRate: number; repeat: number; frames: unknown }[] = []
  const existing = new Set<string>()
  return {
    created,
    existing,
    manager: {
      exists: vi.fn((key: string) => existing.has(key)),
      create: vi.fn((cfg: { key: string; frameRate: number; repeat: number; frames: unknown }) => {
        created.push(cfg)
        existing.add(cfg.key)
        return {}
      }),
      generateFrameNumbers: vi.fn(
        (texture: string, opts: { start: number; end: number }) => ({
          texture,
          start: opts.start,
          end: opts.end,
        }),
      ),
    },
  }
}

describe("registerFireballAnims", () => {
  it("creates fly + channel anims with correct texture keys and frame ranges", () => {
    const { manager, created } = mockAnimManager()

    registerFireballAnims(manager as never)

    const fly = created.find((c) => c.key === FIREBALL_FLY_ANIM)
    const channel = created.find((c) => c.key === FIREBALL_CHANNEL_ANIM)

    expect(fly).toBeDefined()
    expect(channel).toBeDefined()
    expect(fly!.repeat).toBe(-1)
    expect(channel!.repeat).toBe(-1)
    expect(fly!.frames).toEqual({
      texture: FIREBALL_FLY_TEXTURE,
      start: 0,
      end: 7,
    })
    expect(channel!.frames).toEqual({
      texture: FIREBALL_CHANNEL_TEXTURE,
      start: 0,
      end: 7,
    })
  })

  it("is idempotent — does not recreate animations that already exist", () => {
    const { manager, existing } = mockAnimManager()
    existing.add(FIREBALL_FLY_ANIM)
    existing.add(FIREBALL_CHANNEL_ANIM)
    existing.add(LAVA_LAP_ANIM)

    registerFireballAnims(manager as never)

    expect(manager.create).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("phaser", () => {
  /**
   * Converts a packed RGB number into a channel object for test-only Phaser mocks.
   *
   * @param value - Packed RGB value.
   * @returns Split RGB channels.
   */
  function valueToColor(value: number): { r: number; g: number; b: number } {
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff,
    }
  }

  /**
   * Returns a stable packed RGB value from channel inputs for test-only Phaser mocks.
   *
   * @param r - Red channel.
   * @param g - Green channel.
   * @param b - Blue channel.
   * @returns Packed RGB value.
   */
  function getColor(r: number, g: number, b: number): number {
    return (r << 16) | (g << 8) | b
  }

  return {
    default: {
      Display: {
        Color: {
          ValueToColor: valueToColor,
          GetColor: getColor,
          Interpolate: {
            ColorWithColor: (_from: { r: number; g: number; b: number }, to: { r: number; g: number; b: number }) => to,
          },
        },
      },
    },
  }
})

import {
  HP_BAR_OFFSET_Y,
  NAME_TO_HP_BAR_GAP_PX,
  NAMETAG_OFFSET_Y,
  PlayerRenderSystem,
} from "./PlayerRenderSystem"
import { ClientPosition, ClientPlayerState, ClientRenderPos } from "../components"
import { clientEntities, removeEntity } from "../world"
import type { PlayerSnapshot } from "@/shared/types"

function snap(over: Partial<PlayerSnapshot> & Pick<PlayerSnapshot, "id" | "playerId">): PlayerSnapshot {
  return {
    id: over.id,
    playerId: over.playerId,
    username: over.username ?? "u",
    x: over.x ?? 0,
    y: over.y ?? 0,
    vx: over.vx ?? 0,
    vy: over.vy ?? 0,
    facingAngle: over.facingAngle ?? 0,
    health: over.health ?? 10,
    maxHealth: over.maxHealth ?? 10,
    lives: over.lives ?? 3,
    heroId: over.heroId ?? "red_wizard",
    animState: over.animState ?? "idle",
    moveState: over.moveState ?? "idle",
    castingAbilityId: over.castingAbilityId ?? null,
    invulnerable: over.invulnerable ?? false,
    lastProcessedInputSeq: over.lastProcessedInputSeq ?? 0,
  }
}

function sync(players: PlayerSnapshot[]): {
  players: PlayerSnapshot[]
  fireballs: never[]
  seq: number
  serverTimeMs: number
} {
  return { players, fireballs: [], seq: 0, serverTimeMs: Date.now() }
}

function mockSceneAndGroup() {
  const destroyed: string[] = []
  const spriteDestroy = vi.fn(() => destroyed.push("sprite"))
  const textDestroy = vi.fn(() => destroyed.push("text"))
  const gfxDestroy = vi.fn(() => destroyed.push("gfx"))

  const textChain = {
    destroy: textDestroy,
    setOrigin: vi.fn(function textOrigin() {
      return textChain
    }),
    setDepth: vi.fn(function textDepth() {
      return textChain
    }),
    setVisible: vi.fn(),
    setPosition: vi.fn(),
  }

  const scene = {
    add: {
      sprite: vi.fn((x: number, y: number) => {
        const sprite = {
          x,
          y,
          destroy: spriteDestroy,
          setOrigin: vi.fn(),
          setTint: vi.fn(),
          setDepth: vi.fn(),
          play: vi.fn(),
          setPosition: vi.fn((nextX: number, nextY: number) => {
            sprite.x = nextX
            sprite.y = nextY
            return sprite
          }),
          setAlpha: vi.fn(),
        }
        return sprite
      }),
      text: vi.fn(() => textChain),
      graphics: vi.fn(() => ({
        destroy: gfxDestroy,
        setData: vi.fn(),
        setDepth: vi.fn(),
        setVisible: vi.fn(),
        clear: vi.fn(),
        fillStyle: vi.fn(),
        fillRect: vi.fn(),
      })),
    },
  }

  const group = { add: vi.fn() }

  return { scene, group, destroyed, spriteDestroy, textDestroy, gfxDestroy }
}

describe("PlayerRenderSystem.applyFullSync", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"))
    for (const id of [...clientEntities]) {
      removeEntity(id)
      delete ClientPosition[id]
      delete ClientRenderPos[id]
      delete ClientPlayerState[id]
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("destroys Phaser objects when a player leaves the snapshot", () => {
    const { scene, group, destroyed } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    const a = snap({ id: 1, playerId: "p1" })
    const b = snap({ id: 2, playerId: "p2" })
    sys.applyFullSync(sync([a, b]))
    sys.applyFullSync(sync([a]))

    expect(destroyed).toContain("sprite")
    expect(destroyed).toContain("text")
    expect(destroyed).toContain("gfx")
    expect(clientEntities.has(2)).toBe(false)
    expect(ClientPlayerState[2]).toBeUndefined()
  })

  it("renders remote players from the interpolation buffer after a snapshot", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "local-player"

    const now = Date.now()
    sys.applyFullSync({
      players: [snap({ id: 1, playerId: "remote", x: 0, y: 0 })],
      fireballs: [],
      seq: 0,
      serverTimeMs: now,
    })

    // Two remote snapshots straddling the render time; the buffer should
    // interpolate between them and land near the midpoint.
    sys.onRemoteSnapshot(1, { serverTimeMs: now, x: 0, y: 0, vx: 0, vy: 0, facingAngle: 0 })
    sys.onRemoteSnapshot(1, {
      serverTimeMs: now + 100,
      x: 100,
      y: 0,
      vx: 0,
      vy: 0,
      facingAngle: 0,
    })

    vi.setSystemTime(new Date(now + 83))
    sys.update(0, { up: false, down: false, left: false, right: false })

    expect(ClientRenderPos[1].x).toBeGreaterThan(0)
    expect(ClientRenderPos[1].x).toBeLessThan(100)
  })

  it("snaps the local player to the replayed target on large ack errors", () => {
    const { scene, group } = mockSceneAndGroup()
    const sys = new PlayerRenderSystem(scene as never, group as never)
    sys.localPlayerId = "p1"

    sys.applyFullSync(sync([snap({ id: 1, playerId: "p1", x: 0, y: 0 })]))
    ClientRenderPos[1] = { x: 500, y: 0 }

    sys.onLocalAck(1, { x: 0, y: 0, lastProcessedInputSeq: 0 })

    // With no pending replay inputs, replay target = ack position; distance
    // from render (500) to ack (0) is well above snap threshold.
    expect(ClientRenderPos[1]).toEqual({ x: 0, y: 0 })
  })
})

describe("PlayerRenderSystem.heroUiOffsets", () => {
  it("places the HP bar top directly below the nametag bottom", () => {
    expect(HP_BAR_OFFSET_Y).toBe(NAMETAG_OFFSET_Y + NAME_TO_HP_BAR_GAP_PX)
  })
})

import Phaser from "phaser"

import type { LightningBoltPayload } from "@/shared/types"

/** Total duration of the lightning bolt visual in ms. */
const BOLT_DURATION_MS = 300
/** Number of jagged segments per arc. */
const BOLT_SEGMENTS = 12
/** Max perpendicular jitter per segment (pixels). */
const BOLT_JITTER_PX = 14
/** Width of the main arc line. */
const MAIN_ARC_WIDTH = 3
/** Width of branch arc lines. */
const BRANCH_ARC_WIDTH = 1.5
/** Depth for lightning bolt graphics — above players. */
const BOLT_DEPTH = 500

/** Deterministic LCG random number generator seeded by the server-supplied seed. */
function seededRng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0
    return ((s >>> 0) / 0xffffffff)
  }
}

/** Generates a jagged arc as an array of {x, y} points. */
function buildArc(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  segments: number,
  jitter: number,
  rng: () => number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  const nx = -dy / len
  const ny = dx / len

  points.push({ x: x1, y: y1 })
  for (let i = 1; i < segments; i++) {
    const t = i / segments
    const bx = x1 + dx * t
    const by = y1 + dy * t
    const offset = (rng() - 0.5) * 2 * jitter
    points.push({ x: bx + nx * offset, y: by + ny * offset })
  }
  points.push({ x: x2, y: y2 })
  return points
}

/** One active lightning bolt render entry. */
interface BoltEntry {
  gfx: Phaser.GameObjects.Graphics
  elapsed: number
  payload: LightningBoltPayload
}

/**
 * Draws lightning bolt visuals: a jagged main arc plus two branch arcs,
 * fading out over BOLT_DURATION_MS using the server-supplied seed for deterministic branches.
 */
export class LightningBoltRenderSystem {
  private scene: Phaser.Scene
  private bolts: BoltEntry[] = []

  /**
   * @param scene - The Arena scene instance.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /**
   * Spawns a new lightning bolt visual from the server event payload.
   *
   * @param payload - LightningBolt event data including origin, target, and seed.
   */
  spawnBolt(payload: LightningBoltPayload): void {
    const gfx = this.scene.add.graphics()
    gfx.setDepth(BOLT_DEPTH)
    this.bolts.push({ gfx, elapsed: 0, payload })
  }

  /**
   * Per-frame update: redraws all active bolts with current alpha, destroys expired ones.
   *
   * @param delta - Frame delta time in ms.
   */
  update(delta: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]
      bolt.elapsed += delta
      if (bolt.elapsed >= BOLT_DURATION_MS) {
        bolt.gfx.destroy()
        this.bolts.splice(i, 1)
        continue
      }
      const alpha = 1 - bolt.elapsed / BOLT_DURATION_MS
      this._drawBolt(bolt.gfx, bolt.payload, alpha)
    }
  }

  /**
   * Draws the main arc and two branch arcs for a lightning bolt.
   *
   * @param gfx - Graphics object to draw into.
   * @param payload - Server bolt data.
   * @param alpha - Current opacity (1 → 0 over lifetime).
   */
  private _drawBolt(gfx: Phaser.GameObjects.Graphics, payload: LightningBoltPayload, alpha: number): void {
    gfx.clear()
    const rng = seededRng(payload.seed)

    const mainArc = buildArc(
      payload.originX, payload.originY,
      payload.targetX, payload.targetY,
      BOLT_SEGMENTS, BOLT_JITTER_PX, rng,
    )

    // Main arc
    gfx.lineStyle(MAIN_ARC_WIDTH, 0x99ccff, alpha)
    gfx.beginPath()
    gfx.moveTo(mainArc[0].x, mainArc[0].y)
    for (let i = 1; i < mainArc.length; i++) {
      gfx.lineTo(mainArc[i].x, mainArc[i].y)
    }
    gfx.strokePath()

    // Inner bright core
    gfx.lineStyle(1, 0xffffff, alpha * 0.8)
    gfx.beginPath()
    gfx.moveTo(mainArc[0].x, mainArc[0].y)
    for (let i = 1; i < mainArc.length; i++) {
      gfx.lineTo(mainArc[i].x, mainArc[i].y)
    }
    gfx.strokePath()

    // Two branch arcs from random mid-points
    for (let b = 0; b < 2; b++) {
      const midIdx = Math.floor(rng() * (mainArc.length - 2)) + 1
      const mid = mainArc[midIdx]
      const branchLen = 40 + rng() * 60
      const branchAngle = Math.atan2(
        payload.targetY - payload.originY,
        payload.targetX - payload.originX,
      ) + (rng() - 0.5) * Math.PI * 0.8
      const bx2 = mid.x + Math.cos(branchAngle) * branchLen
      const by2 = mid.y + Math.sin(branchAngle) * branchLen

      const branchArc = buildArc(mid.x, mid.y, bx2, by2, BOLT_SEGMENTS / 2, BOLT_JITTER_PX * 0.5, rng)
      gfx.lineStyle(BRANCH_ARC_WIDTH, 0x77aaff, alpha * 0.7)
      gfx.beginPath()
      gfx.moveTo(branchArc[0].x, branchArc[0].y)
      for (let i = 1; i < branchArc.length; i++) {
        gfx.lineTo(branchArc[i].x, branchArc[i].y)
      }
      gfx.strokePath()
    }
  }

  /** Destroys all active bolt graphics. Call on scene shutdown. */
  destroy(): void {
    for (const bolt of this.bolts) {
      bolt.gfx.destroy()
    }
    this.bolts = []
  }
}

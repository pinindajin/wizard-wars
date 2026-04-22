import Phaser from "phaser"

import { AXE_SWING_ARC_DEG, AXE_SWING_RADIUS_PX, AXE_SWING_DURATION_MS } from "@/shared/balance-config/combat"
import type { AxeSwingPayload } from "@/shared/types"

/** Depth for axe swing graphics — above players. */
const AXE_SWING_DEPTH = 600
/** Fill color of the swing cone. */
const CONE_FILL_COLOR = 0xff8833
/** Stroke color of the swing cone. */
const CONE_STROKE_COLOR = 0xffcc66

/** One active axe swing render entry. */
interface SwingEntry {
  gfx: Phaser.GameObjects.Graphics
  sprite: Phaser.GameObjects.Sprite | null
  elapsed: number
  payload: AxeSwingPayload
}

/**
 * Renders axe swing visuals: a 90° cone graphic that fades over AXE_SWING_DURATION_MS.
 */
export class AxeSwingRenderSystem {
  private scene: Phaser.Scene
  private swings: SwingEntry[] = []

  /**
   * @param scene - The Arena scene instance.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /**
   * Spawns a new axe swing visual from a server event.
   *
   * @param payload - AxeSwing event data including caster position and facing angle.
   */
  spawnSwing(payload: AxeSwingPayload): void {
    const gfx = this.scene.add.graphics()
    gfx.setDepth(AXE_SWING_DEPTH)

    let sprite: Phaser.GameObjects.Sprite | null = null
    if (this.scene.textures.exists("axe")) {
      sprite = this.scene.add.sprite(payload.x, payload.y, "axe")
      sprite.setDepth(AXE_SWING_DEPTH + 1)
      sprite.setRotation(payload.facingAngle)
    }

    this.swings.push({ gfx, sprite, elapsed: 0, payload })
  }

  /**
   * Per-frame update: redraws cones with current alpha, destroys expired swings.
   *
   * @param delta - Frame delta time in ms.
   */
  update(delta: number): void {
    for (let i = this.swings.length - 1; i >= 0; i--) {
      const sw = this.swings[i]
      sw.elapsed += delta
      if (sw.elapsed >= AXE_SWING_DURATION_MS) {
        sw.gfx.destroy()
        sw.sprite?.destroy()
        this.swings.splice(i, 1)
        continue
      }
      const progress = sw.elapsed / AXE_SWING_DURATION_MS
      const alpha = 1 - progress
      this._drawCone(sw.gfx, sw.payload, alpha, progress)

      if (sw.sprite) {
        sw.sprite.setAlpha(alpha)
        const swingAngle = sw.payload.facingAngle - (Math.PI / 4) + (Math.PI / 2) * progress
        sw.sprite.setPosition(
          sw.payload.x + Math.cos(swingAngle) * AXE_SWING_RADIUS_PX * 0.6,
          sw.payload.y + Math.sin(swingAngle) * AXE_SWING_RADIUS_PX * 0.6,
        )
        sw.sprite.setRotation(swingAngle)
      }
    }
  }

  /**
   * Draws the axe swing cone.
   *
   * @param gfx - Graphics object to draw into.
   * @param payload - Swing event data.
   * @param alpha - Current opacity.
   * @param progress - Animation progress 0–1.
   */
  private _drawCone(
    gfx: Phaser.GameObjects.Graphics,
    payload: AxeSwingPayload,
    alpha: number,
    progress: number,
  ): void {
    gfx.clear()

    const halfArc = (AXE_SWING_ARC_DEG / 2) * (Math.PI / 180)
    const startAngle = payload.facingAngle - halfArc
    const endAngle = startAngle + halfArc * 2 * progress

    gfx.fillStyle(CONE_FILL_COLOR, alpha * 0.35)
    gfx.beginPath()
    gfx.moveTo(payload.x, payload.y)
    gfx.arc(payload.x, payload.y, AXE_SWING_RADIUS_PX, startAngle, endAngle, false)
    gfx.closePath()
    gfx.fillPath()

    gfx.lineStyle(2, CONE_STROKE_COLOR, alpha * 0.8)
    gfx.beginPath()
    gfx.moveTo(payload.x, payload.y)
    gfx.arc(payload.x, payload.y, AXE_SWING_RADIUS_PX, startAngle, endAngle, false)
    gfx.closePath()
    gfx.strokePath()
  }

  /** Destroys all active swing graphics. Call on scene shutdown. */
  destroy(): void {
    for (const sw of this.swings) {
      sw.gfx.destroy()
      sw.sprite?.destroy()
    }
    this.swings = []
  }
}

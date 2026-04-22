import Phaser from "phaser"

import type { DamageFloatPayload } from "@/shared/types"

/** Total float duration in ms. */
const FLOAT_DURATION_MS = 800
/** Pixels to float upward over the full duration. */
const FLOAT_RISE_PX = 48
/** Depth for floater text — above all game objects. */
const FLOATER_DEPTH = 1000

/** One active damage floater. */
interface FloaterEntry {
  text: Phaser.GameObjects.Text
  elapsed: number
  startY: number
}

/**
 * Spawns and animates floating damage number text objects.
 * Numbers float upward and fade out over FLOAT_DURATION_MS.
 */
export class DamageFloatersSystem {
  private scene: Phaser.Scene
  private floaters: FloaterEntry[] = []

  /**
   * @param scene - The Arena scene instance.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /**
   * Spawns a new damage number floater at the hit position.
   *
   * @param payload - DamageFloat event data with position, amount, and crit flag.
   */
  spawn(payload: DamageFloatPayload): void {
    const isCrit = payload.isCrit ?? false
    const label = isCrit ? `${payload.amount}!` : `${payload.amount}`
    const fontSize = isCrit ? "18px" : "13px"
    const color = isCrit ? "#ff4444" : "#ffffff"

    const text = this.scene.add
      .text(payload.x, payload.y, label, {
        fontSize,
        fontFamily: "monospace",
        color,
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(FLOATER_DEPTH)

    this.floaters.push({ text, elapsed: 0, startY: payload.y })
  }

  /**
   * Per-frame update: moves floaters upward and fades them out.
   *
   * @param delta - Frame delta time in ms.
   */
  update(delta: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]
      f.elapsed += delta
      if (f.elapsed >= FLOAT_DURATION_MS) {
        f.text.destroy()
        this.floaters.splice(i, 1)
        continue
      }
      const progress = f.elapsed / FLOAT_DURATION_MS
      f.text.setY(f.startY - FLOAT_RISE_PX * progress)
      f.text.setAlpha(1 - progress)
    }
  }

  /** Destroys all active floaters. Call on scene shutdown. */
  destroy(): void {
    for (const f of this.floaters) {
      f.text.destroy()
    }
    this.floaters = []
  }
}

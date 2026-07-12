import Phaser from "phaser"

import type { PrimaryMeleeAttackPayload } from "@/shared/types"
import { helenaEnergyWaveSpec } from "./helenaEnergyWave"

export const HELENA_ENERGY_WAVE_TEXTURE_KEY = "helena-energy-wave"
export const HELENA_ENERGY_WAVE_ANIM_KEY = "helena-energy-wave-pulse"
const HELENA_ENERGY_WAVE_FRAMES = 8

/** Registers the one-shot wave pulse animation when its asset is available. */
export function registerHelenaEnergyWaveAnimation(
  animManager: Phaser.Animations.AnimationManager,
): void {
  if (animManager.exists(HELENA_ENERGY_WAVE_ANIM_KEY)) return
  animManager.create({
    key: HELENA_ENERGY_WAVE_ANIM_KEY,
    frames: animManager.generateFrameNumbers(HELENA_ENERGY_WAVE_TEXTURE_KEY, {
      start: 0,
      end: HELENA_ENERGY_WAVE_FRAMES - 1,
    }),
    frameRate: HELENA_ENERGY_WAVE_FRAMES / 0.27,
    repeat: 0,
  })
}

/** Owns Helena's cosmetic melee-wave objects and teardown. */
export class HelenaEnergyWaveSystem {
  private readonly timers = new Set<Phaser.Time.TimerEvent>()
  private readonly sprites = new Set<Phaser.GameObjects.Sprite>()

  constructor(private readonly scene: Phaser.Scene) {
    registerHelenaEnergyWaveAnimation(scene.anims)
  }

  spawn(payload: PrimaryMeleeAttackPayload): void {
    const spec = helenaEnergyWaveSpec(payload)
    if (!spec || !this.sceneAcceptsObjects()) return

    const timer = this.scene.time.delayedCall(spec.delayMs, () => {
      this.timers.delete(timer)
      if (!this.sceneAcceptsObjects()) return
      const sprite = this.scene.add
        .sprite(spec.startX, spec.startY, HELENA_ENERGY_WAVE_TEXTURE_KEY)
        .setOrigin(0.5, 0.5)
        .setRotation(spec.rotation)
        .setDepth(spec.startY + 1)
      this.sprites.add(sprite)
      sprite.play(HELENA_ENERGY_WAVE_ANIM_KEY)
      this.scene.tweens.add({
        targets: sprite,
        x: spec.endX,
        y: spec.endY,
        alpha: 0,
        duration: spec.durationMs,
        ease: "Quad.easeOut",
        onComplete: () => {
          this.sprites.delete(sprite)
          sprite.destroy()
        },
      })
    })
    this.timers.add(timer)
  }

  destroy(): void {
    for (const timer of this.timers) timer.remove(false)
    this.timers.clear()
    for (const sprite of this.sprites) sprite.destroy()
    this.sprites.clear()
  }

  private sceneAcceptsObjects(): boolean {
    const status = this.scene.sys?.settings?.status
    return status !== Phaser.Scenes.SHUTDOWN && status !== Phaser.Scenes.DESTROYED
  }
}
